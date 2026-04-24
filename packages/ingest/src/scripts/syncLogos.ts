// Wave 3 Lane 1 — sync team logos from MaxPreps PA lacrosse schools page.
//
// Pipeline:
//   1. Fetch MaxPreps schools index (~200 PA schools).
//   2. For each school, find a `teams` row by exact-normalized match against
//      teams.name first, then teams.slug. Honors data/team-overrides.json
//      ({ "<phillylax-team-name>": "<maxpreps-slug>" }) for manual fixups.
//   3. Download the logo gif to data/logos/<team_slug>.gif (skip if file
//      already exists with same byte size from Content-Length).
//   4. Update teams.logo_url and teams.maxpreps_slug in the DB. Always
//      re-write the DB row (idempotent in DB, file-skip in fs).
//   5. Log a final summary plus the unmatched MaxPreps teams (informational).
//
// 250ms delay between downloads to be polite to the CDN.
//
// Run: `pnpm --filter @pll/ingest run sync:logos`

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../db.js';
import { normalizeTeamName as normalizeForMatch } from '../normalize/teamName.js';
import {
  fetchMaxprepsSchools,
  type MaxprepsSchool,
} from '../sources/maxprepsSchools.js';
import { downloadLogo } from '../sources/logoDownload.js';

import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:syncLogos' });
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DB_PATH = process.env.DB_PATH ?? process.env.PLL_DB_PATH ?? path.join(REPO_ROOT, 'data', 'lacrosse.db');
const LOGOS_DIR = path.join(REPO_ROOT, 'data', 'logos');
const OVERRIDES_PATH = path.join(REPO_ROOT, 'data', 'team-overrides.json');
const DOWNLOAD_DELAY_MS = 250;

interface TeamRow {
  id: number;
  name: string;
  slug: string;
}

interface MatchResult {
  team: TeamRow;
  school: MaxprepsSchool;
}

/**
 * Generate all normalized lookup keys for a team/school name. Returned as an
 * ordered list — index 0 is the strict exact-normalized key, subsequent
 * entries are looser variants (suffix-stripped, WC→West Chester, Saint↔St).
 * Looser keys are only safe to use when they map to exactly one team.
 */
function matchKeys(s: string): string[] {
  let n: string;
  try {
    n = normalizeForMatch(s);
  } catch {
    n = s;
  }
  // Lowercase, decode common HTML entities, drop preserved (NJ)/(NY) markers
  // so cross-state matches still hash equal (we already have separate DB
  // teams for OOS, so PA-only matching ignores them).
  let base = n
    .toLowerCase()
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  const keys = new Set<string>();
  if (base) keys.add(base);

  // Iteratively peel common school-name suffixes.
  const SUFFIXES = [
    'senior high school',
    'senior high',
    'high school',
    'high',
    'school',
    'academy',
    'area',
    'hs',
    'prep',
    'preparatory',
    'college',
    'township',
    'hebrew',
  ];
  let stripped = base;
  for (let i = 0; i < 8; i += 1) {
    let changed = false;
    for (const suf of SUFFIXES) {
      if (stripped === suf) continue;
      if (stripped.endsWith(' ' + suf)) {
        stripped = stripped.slice(0, stripped.length - suf.length).trim();
        changed = true;
      }
    }
    if (!changed) break;
  }
  if (stripped && stripped !== base) keys.add(stripped);

  // WC ↔ West Chester prefix swap on the stripped form.
  if (stripped.startsWith('wc ')) keys.add('west chester ' + stripped.slice(3));
  if (stripped.startsWith('west chester ')) keys.add(stripped.slice('west chester '.length));

  // St ↔ Saint
  if (stripped.startsWith('st ')) keys.add('saint ' + stripped.slice(3));
  if (stripped.startsWith('saint ')) keys.add('st ' + stripped.slice(6));

  return Array.from(keys);
}

function loadOverrides(): Record<string, string> {
  if (!fs.existsSync(OVERRIDES_PATH)) {
    fs.mkdirSync(path.dirname(OVERRIDES_PATH), { recursive: true });
    fs.writeFileSync(OVERRIDES_PATH, '{}\n', 'utf8');
    return {};
  }
  try {
    const raw = fs.readFileSync(OVERRIDES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        // Skip underscore-prefixed metadata keys (e.g. "_comment").
        if (k.startsWith('_')) continue;
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
  } catch (err) {
    log.warn(`[syncLogos] could not parse ${OVERRIDES_PATH}: ${(err as Error).message}`);
  }
  return {};
}

interface DownloadOutcome {
  written: boolean;
  bytes: number;
  filename: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  log.info(`[syncLogos] db=${DB_PATH}`);
  log.info(`[syncLogos] logos dir=${LOGOS_DIR}`);
  fs.mkdirSync(LOGOS_DIR, { recursive: true });

  const db = openDb(DB_PATH);
  const teams = db.prepare('SELECT id, name, slug FROM teams').all() as TeamRow[];
  log.info(`[syncLogos] ${teams.length} teams in DB`);

  // For each team, index ALL of its candidate keys. Exact key = index 0;
  // looser keys (suffix-stripped, WC→West Chester) are subsequent. We track
  // the strict-vs-loose tier so loose matches only resolve when unique.
  interface Indexed {
    team: TeamRow;
    keysName: string[];
    keysSlug: string[];
  }
  const indexed: Indexed[] = teams.map((t) => ({
    team: t,
    keysName: matchKeys(t.name),
    keysSlug: matchKeys(t.slug.replace(/-/g, ' ')),
  }));
  // Strict map: only the index-0 key.
  const strict = new Map<string, TeamRow>();
  // Loose map: all keys → list of teams (used only when length === 1).
  const loose = new Map<string, TeamRow[]>();
  for (const { team, keysName, keysSlug } of indexed) {
    const all = new Set<string>([...keysName, ...keysSlug]);
    const strictKeys = new Set<string>(
      [keysName[0], keysSlug[0]].filter((k): k is string => Boolean(k)),
    );
    for (const k of strictKeys) {
      if (!strict.has(k)) strict.set(k, team);
    }
    for (const k of all) {
      const arr = loose.get(k) ?? [];
      arr.push(team);
      loose.set(k, arr);
    }
  }

  // Fetch MaxPreps directory.
  const schools = await fetchMaxprepsSchools();
  log.info(`[syncLogos] fetched ${schools.length} MaxPreps schools`);
  if (schools.length === 0) {
    log.error('[syncLogos] zero schools parsed — aborting');
    db.close();
    process.exitCode = 1;
    return;
  }

  // Load manual overrides: { "<phillylax team name>": "<maxpreps slug>" }
  const overrides = loadOverrides();
  const overrideMatches: MatchResult[] = [];
  for (const [phillyName, mpSlug] of Object.entries(overrides)) {
    const phillyKeys = matchKeys(phillyName);
    let team: TeamRow | undefined;
    for (const k of phillyKeys) {
      team = strict.get(k);
      if (team) break;
    }
    if (!team) {
      const arr = loose.get(phillyKeys[0] ?? '') ?? [];
      if (arr.length === 1) team = arr[0];
    }
    const school = schools.find((s) => s.maxprepsSlug === mpSlug);
    if (team && school) overrideMatches.push({ team, school });
    else if (!school)
      log.warn(`[syncLogos] override target slug not found in MaxPreps: ${mpSlug}`);
    else if (!team)
      log.warn(`[syncLogos] override DB team not found: ${phillyName}`);
  }

  const matchesByTeamId = new Map<number, MatchResult>();
  for (const m of overrideMatches) matchesByTeamId.set(m.team.id, m);

  // Round 1: strict exact-normalized match on name OR slug. We DO NOT skip
  // schools that are referenced by overrides — multiple DB rows can share a
  // single MaxPreps school (alias rows, dedup leftovers), and matchesByTeamId
  // is keyed by team.id so overrides still take precedence per-team.
  const unmatchedSchools: MaxprepsSchool[] = [];
  for (const school of schools) {
    const keys = matchKeys(school.name);
    let team: TeamRow | undefined;
    for (const k of keys) {
      team = strict.get(k);
      if (team) break;
    }
    if (!team) {
      unmatchedSchools.push(school);
      continue;
    }
    if (!matchesByTeamId.has(team.id)) {
      matchesByTeamId.set(team.id, { team, school });
    }
  }

  // Round 2: looser match — accept only when the looser key resolves to
  // exactly ONE team (after excluding already-matched teams). This handles
  // suffix mismatches like DB "Easton" ↔ MP "Easton Area" without risking
  // collisions like "East" matching multiple teams. Loose round can ALSO
  // match the same school used by an override — different DB rows; OK.
  const stillUnmatched: MaxprepsSchool[] = [];
  for (const school of unmatchedSchools) {
    const keys = matchKeys(school.name);
    let resolved: TeamRow | undefined;
    for (const k of keys) {
      const cands = (loose.get(k) ?? []).filter((t) => !matchesByTeamId.has(t.id));
      if (cands.length === 1) {
        resolved = cands[0];
        break;
      }
    }
    if (resolved) matchesByTeamId.set(resolved.id, { team: resolved, school });
    else stillUnmatched.push(school);
  }
  // Round 3: DB-side duplicate rows. Some teams have alias rows like
  // "hatboro-horsham-2", "spring-ford-2", "westtown-school" alongside the
  // canonical row. After rounds 1+2, the canonical row owns the school; the
  // dup is left orphaned. For each unmatched DB team, look up MaxPreps
  // schools (via the schoolsByKey map) and, if exactly one school's keys
  // resolve, share that school with the dup. School can be re-used because
  // the on-disk logo is keyed by `team.slug`, not by school slug.
  const schoolsByKey = new Map<string, MaxprepsSchool[]>();
  for (const school of schools) {
    for (const k of matchKeys(school.name)) {
      const arr = schoolsByKey.get(k) ?? [];
      arr.push(school);
      schoolsByKey.set(k, arr);
    }
  }
  for (const t of teams) {
    if (matchesByTeamId.has(t.id)) continue;
    const teamKeys = new Set<string>([...matchKeys(t.name), ...matchKeys(t.slug.replace(/-/g, ' '))]);
    let resolved: MaxprepsSchool | undefined;
    for (const k of teamKeys) {
      const cands = schoolsByKey.get(k) ?? [];
      if (cands.length === 1) {
        resolved = cands[0];
        break;
      }
    }
    if (resolved) matchesByTeamId.set(t.id, { team: t, school: resolved });
  }

  // Mark schools whose slug we DID use (via override or strict/loose) as
  // "informational only" rather than truly unmatched — they have a home in
  // the DB even though not via this iteration.
  const usedSlugs = new Set<string>();
  for (const m of matchesByTeamId.values()) usedSlugs.add(m.school.maxprepsSlug);
  const unmatched = stillUnmatched.filter((s) => !usedSlugs.has(s.maxprepsSlug));

  log.info(
    `[syncLogos] matched ${matchesByTeamId.size}/${teams.length} teams ` +
      `(${((matchesByTeamId.size / teams.length) * 100).toFixed(1)}%)`,
  );
  log.info(`[syncLogos] ${unmatched.length} MaxPreps schools have no DB team`);

  // Prepare updates.
  const updateTeam = db.prepare(
    'UPDATE teams SET logo_url = ?, maxpreps_slug = ? WHERE id = ?',
  );

  let downloaded = 0;
  let skipped = 0;
  let totalBytes = 0;
  let failed = 0;
  let dbWrites = 0;

  const matches = Array.from(matchesByTeamId.values());
  for (let i = 0; i < matches.length; i += 1) {
    const { team, school } = matches[i] as MatchResult;
    if (!school.logoUrl) {
      // No logo on MaxPreps — record the slug but leave logo_url null.
      updateTeam.run(null, school.maxprepsSlug, team.id);
      dbWrites += 1;
      continue;
    }
    const filename = `${team.slug}.gif`;
    const destPath = path.join(LOGOS_DIR, filename);
    try {
      const outcome = await downloadLogo(school.logoUrl, destPath);
      if (outcome.written) downloaded += 1;
      else skipped += 1;
      totalBytes += outcome.bytes;
      updateTeam.run(filename, school.maxprepsSlug, team.id);
      dbWrites += 1;
    } catch (err) {
      failed += 1;
      log.warn(
        `[syncLogos] failed to download ${team.name} from ${school.logoUrl}: ` +
          (err as Error).message,
      );
    }
    if (i + 1 < matches.length) await sleep(DOWNLOAD_DELAY_MS);
  }

  // Verify count from DB.
  const withLogo = db
    .prepare('SELECT COUNT(*) AS c FROM teams WHERE logo_url IS NOT NULL')
    .get() as { c: number };

  log.info('');
  log.info('[syncLogos] ===== summary =====');
  log.info(`  teams in db:        ${teams.length}`);
  log.info(`  maxpreps schools:   ${schools.length}`);
  log.info(`  matched:            ${matchesByTeamId.size}`);
  log.info(`  db rows updated:    ${dbWrites}`);
  log.info(`  logos downloaded:   ${downloaded}`);
  log.info(`  logos skipped:      ${skipped} (already cached)`);
  log.info(`  download failures:  ${failed}`);
  log.info(`  teams with logo:    ${withLogo.c}`);
  log.info(`  total logo bytes:   ${totalBytes} (${(totalBytes / 1024).toFixed(1)} KiB)`);
  log.info('');
  log.info('[syncLogos] ===== unmatched MaxPreps schools =====');
  if (unmatched.length === 0) {
    log.info('  (none)');
  } else {
    for (const s of unmatched) {
      log.info(`  - ${s.name} (${s.city}, ${s.state}) [/${s.maxprepsSlug}/]`);
    }
  }

  db.close();
}

main().catch((err) => {
  log.error('[syncLogos] failed:', err);
  process.exit(1);
});
