// seedTeamAliases.ts — bootstrap team_aliases for PIAA-name variants.
//
// Wave 6 Lane 1: 49 of 59 PIAA District 1 teams join cleanly to teams.name
// via LOWER(name) = name_normalized. The remaining 10 either need an alias
// row or correspond to teams we don't track (PhillyLacrosse RSS coverage
// gap). This script seeds the genuine matches and skips the rest.
//
// Mappings (verified manually 2026-04-22 against live data/lacrosse.db):
//   cb south            -> 56  Central Bucks South
//   cb west             -> 68  Central Bucks West
//   hatborohorsham      -> 100 Hatboro-Horsham      (PIAA strips the hyphen)
//   haverford           -> 36  Haverford High       (NOT 11 Haverford School;
//                                                   Haverford School is the
//                                                   private Inter-Ac team and
//                                                   a different program)
//   new hope solebury   -> 10  New Hope-Solebury    (W8 dedup kept the hyphen
//                                                   variant; PIAA name uses a
//                                                   space, so add an alias)
//   owen j roberts      -> 14  Owen J. Roberts
//   springfield         -> 37  Springfield-Delco    (PIAA 3A delco)
//   springfield twp     -> 174 Springfield Township (PIAA 2A montco)
//   springford          -> 1   Spring-Ford
//
// Skipped (no corresponding teams row, both 0-0 PIAA records):
//   harry s truman, william tennent
//
// Idempotent: uses INSERT OR IGNORE against the UNIQUE(alias) constraint.
//
// Usage:
//   pnpm --filter @pll/ingest aliases:seed            # dry-run
//   pnpm --filter @pll/ingest aliases:seed -- --apply # writes

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';

export interface AliasMapping {
  alias: string;
  teamId: number;
  /** Human-readable team name, for logs only. */
  teamName: string;
}

export const PIAA_ALIASES: readonly AliasMapping[] = [
  { alias: 'cb south', teamId: 56, teamName: 'Central Bucks South' },
  { alias: 'cb west', teamId: 68, teamName: 'Central Bucks West' },
  { alias: 'hatborohorsham', teamId: 100, teamName: 'Hatboro-Horsham' },
  { alias: 'haverford', teamId: 36, teamName: 'Haverford High' },
  { alias: 'new hope solebury', teamId: 10, teamName: 'New Hope-Solebury' },
  { alias: 'owen j roberts', teamId: 14, teamName: 'Owen J. Roberts' },
  { alias: 'springfield', teamId: 37, teamName: 'Springfield-Delco' },
  { alias: 'springfield twp', teamId: 174, teamName: 'Springfield Township' },
  { alias: 'springford', teamId: 1, teamName: 'Spring-Ford' },
];

export const ALIAS_SOURCE = 'piaa-bootstrap';

// ─── Wave 10 Lane 1 — parser-abbreviation aliases ────────────────────────
//
// The Wave 9 parser-strictness fix turned silent default-to-home into hard
// anomalies. Top remaining anomaly bucket (2,694 of 3,140) is "sub-header
// did not match either game team": real player-stat blocks whose team token
// is a short abbreviation (MHS, JBHA, OJR, …) the resolver cannot map.
//
// All mappings below were derived from the W10 anomaly-table top-N hits
// and verified by id against the live data/lacrosse.db on 2026-04-22:
//
//   sqlite3 data/lacrosse.db "SELECT id,name FROM teams WHERE id IN (...);"
//
// Aliases are written in normalized form (lowercase, internal whitespace
// collapsed, trailing HS/H.S./High School stripped — see normalizeTeamName).
//
// Springside Chestnut Hill and Jack Barrack target the canonical row left
// after the W10 dedupTeams pass (id 161 and 53 respectively). The dedup
// pass also re-targets any aliases attached to merged-from rows.
export const PARSER_ABBREVIATIONS: readonly AliasMapping[] = [
  { alias: 'umerion', teamId: 82, teamName: 'Upper Merion' },
  { alias: 'qhs', teamId: 98, teamName: 'Quakertown' },
  { alias: 'mhs', teamId: 3, teamName: 'Methacton' },
  { alias: 'phx', teamId: 4, teamName: 'Phoenixville' },
  { alias: 'jbha', teamId: 53, teamName: 'Jack Barrack' },
  { alias: 'jack barrack academy', teamId: 53, teamName: 'Jack Barrack' },
  { alias: 'jack barrack hebrew academy', teamId: 53, teamName: 'Jack Barrack' },
  { alias: 'hhs', teamId: 36, teamName: 'Haverford High' },
  { alias: 'dte', teamId: 43, teamName: 'Downingtown East' },
  { alias: 'dtw', teamId: 84, teamName: 'Downingtown West' },
  { alias: 'ojr', teamId: 14, teamName: 'Owen J. Roberts' },
  { alias: 'pjp', teamId: 18, teamName: 'Pope John Paul II' },
  { alias: 'sjp', teamId: 108, teamName: "St. Joseph's Prep" },
  { alias: 'wch', teamId: 41, teamName: 'WC Henderson' },
  { alias: 'wce', teamId: 188, teamName: 'West Chester East' },
  { alias: 'cbe', teamId: 69, teamName: 'Central Bucks East' },
  { alias: 'cb east', teamId: 69, teamName: 'Central Bucks East' },
  { alias: 'cbw', teamId: 68, teamName: 'Central Bucks West' },
  { alias: 'abw', teamId: 59, teamName: 'Archbishop Wood' },
  { alias: 'sch', teamId: 161, teamName: 'Springside Chestnut Hill' },
  { alias: 'springside chestnut hill academy', teamId: 161, teamName: 'Springside Chestnut Hill' },
  { alias: 'tv', teamId: 48, teamName: 'Twin Valley' },
  { alias: 'ga', teamId: 32, teamName: 'Germantown Academy' },
  { alias: 'ea', teamId: 12, teamName: 'Episcopal Academy' },
  { alias: 'lm', teamId: 34, teamName: 'Lower Merion' },
  { alias: 'pc', teamId: 31, teamName: 'Penn Charter' },
  { alias: 'shanahan', teamId: 46, teamName: 'Bishop Shanahan' },
  { alias: "o'hara", teamId: 65, teamName: "Cardinal O'Hara" },
  // Post-merge alias breadcrumbs — the dedup pass collapses these display
  // names into their canonical row; the alias keeps any future raw-text
  // occurrence resolving to the right team.
  { alias: 'barrack academy', teamId: 53, teamName: 'Jack Barrack' },
  { alias: 'wc east', teamId: 188, teamName: 'West Chester East' },
  { alias: 'wc henderson', teamId: 41, teamName: 'WC Henderson' },
  { alias: 'hatboro horsham', teamId: 100, teamName: 'Hatboro-Horsham' },
  // Short-form sub-headers the parser saw inside player blocks (verified
  // against raw-cache HTML; no other PA-area program shares these tokens
  // in our dataset, so confidence remains high).
  { alias: 'ryan', teamId: 62, teamName: 'Archbishop Ryan' },

  // ─── Wave 11 Lane 1 — high-frequency sub-header tokens ────────────────
  // Added after Chewy 🐻💪's parser suffix-strip pass surfaced ~1,720
  // remaining sub-header anomalies. Each token below was verified against
  // the live anomaly table by joining `ingest_anomalies.parent_game_id`
  // back to `games` and confirming the token's team appears as either
  // home or away in EVERY anomaly row (i.e. unambiguous, in-game).
  { alias: 'pv', teamId: 13, teamName: 'Perkiomen Valley' },
  { alias: 'rustin', teamId: 45, teamName: 'WC Rustin' },
  { alias: 'mn', teamId: 35, teamName: 'Marple Newtown' },
  { alias: 'hgp', teamId: 16, teamName: 'Holy Ghost Prep' },
  { alias: 'wiss', teamId: 76, teamName: 'Wissahickon' },
  { alias: 'moravian', teamId: 89, teamName: 'Moravian Academy' },
  { alias: 'wood', teamId: 59, teamName: 'Archbishop Wood' },
  { alias: 'barrack', teamId: 53, teamName: 'Jack Barrack' },
  { alias: 'jba', teamId: 53, teamName: 'Jack Barrack' },
  { alias: 'hill', teamId: 106, teamName: 'Hill School' },
  { alias: 'new hope', teamId: 10, teamName: 'New Hope-Solebury' },
  { alias: 'springfield-d', teamId: 37, teamName: 'Springfield-Delco' },
  { alias: 'd east', teamId: 43, teamName: 'Downingtown East' },
  { alias: 'perk school', teamId: 115, teamName: 'Perkiomen School' },
  { alias: 'shipley', teamId: 116, teamName: 'Shipley School' },
  { alias: 'west chester east', teamId: 188, teamName: 'West Chester East' },
  // Second batch — disambiguated by anomaly→game join (≥85% one team).
  { alias: 'pw', teamId: 61, teamName: 'Plymouth Whitemarsh' },
  { alias: 'hh', teamId: 100, teamName: 'Hatboro-Horsham' },
  { alias: 'lc', teamId: 186, teamName: 'Lansdale Catholic' },
  { alias: 'anc', teamId: 110, teamName: 'Academy of the New Church' },
  { alias: 'stoga', teamId: 33, teamName: 'Conestoga' },
  { alias: 'tvalley', teamId: 48, teamName: 'Twin Valley' },
  { alias: 'carroll', teamId: 94, teamName: 'Archbishop Carroll' },
  { alias: 'arch carroll', teamId: 94, teamName: 'Archbishop Carroll' },
  { alias: 'ag', teamId: 77, teamName: 'Avon Grove' },

  // ─── Wave 13 Lane 1 — section-only headers + remaining unambiguous abbrevs ──
  // Verified against live anomaly→game joins on 2026-04-22 (Chewy 🐻💪).
  // "Pburg" appears only in Easton vs Phillipsburg games → id 232.
  // "Solehi" appears only in Parkland vs Southern Lehigh games → id 87.
  { alias: 'pburg', teamId: 232, teamName: 'Phillipsburg' },
  { alias: 'solehi', teamId: 87, teamName: 'Southern Lehigh' },
];

export const PARSER_ABBREV_SOURCE = 'parser-abbrev-w10';

// Tokens deliberately NOT seeded — too ambiguous for a high-confidence
// alias. Parser will continue to log these as anomalies for manual triage.
export interface SkippedAmbiguousNote {
  token: string;
  rationale: string;
}

export const SKIPPED_AMBIGUOUS: readonly SkippedAmbiguousNote[] = [
  { token: 'bhs', rationale: 'Could be Boyertown, Bensalem, Bonner — multiple BHS schools in coverage area.' },
  { token: 'dv', rationale: 'Delaware Valley vs Downingtown Varsity vs Daniel Webster — no dominant signal in anomaly samples.' },
  { token: 'mr', rationale: 'Marple-Newtown? Methacton Reserves? Manor? Insufficient context to disambiguate.' },
  { token: 'ac', rationale: 'Archmere vs Avon Grove vs Athletic Club — sub-header context did not lean to any single team.' },
  { token: 'ag', rationale: 'Avon Grove vs Archbishop Goretti — both plausible PA programs, leave for manual triage.' },
  // ─── W11 (Chewy 🐻💪) — surfaced by suffix-strip but still ambiguous ───
  { token: 'prep', rationale: 'Malvern Prep vs SJP vs Holy Ghost Prep vs La Salle College Prep — context-dependent.' },
  { token: 'nhs', rationale: 'Could be New Hope-Solebury or Neshaminy — risk of mis-attribution to wrong NHS.' },
  // ─── W13 (Chewy 🐻💪) — Darth's hint list, but verification rejected ───
  { token: 'lc-extra', rationale: 'Already aliased to Lansdale Catholic in W11; Darth recommended Lower Merion but no anomaly samples support that — keep existing mapping.' },
  { token: 'pburg-extra', rationale: 'Darth suggested Phoenixville/Pottsville; live data shows the only "Pburg" usage is Phillipsburg (verified by anomaly→game join). Seeded id=232.' },
];

export interface SeedResult {
  inserted: number;
  alreadyPresent: number;
  /** Aliases referencing a team_id that doesn't exist (defensive: 0 expected). */
  missingTeam: AliasMapping[];
}

/**
 * Idempotent insert. Returns counts split by outcome. Any mapping whose
 * team_id is missing from the teams table is reported (not inserted) so the
 * operator can investigate without crashing the run.
 */
export function seedAliases(
  db: Database,
  mappings: readonly AliasMapping[] = PIAA_ALIASES,
  source: string = ALIAS_SOURCE,
): SeedResult {
  const teamExists = db.prepare('SELECT 1 FROM teams WHERE id = ?');
  const insert = db.prepare(
    `INSERT OR IGNORE INTO team_aliases (alias, team_id, source, confidence)
       VALUES (?, ?, ?, 1.0)`,
  );

  let inserted = 0;
  let alreadyPresent = 0;
  const missingTeam: AliasMapping[] = [];

  const tx = db.transaction(() => {
    for (const m of mappings) {
      if (!teamExists.get(m.teamId)) {
        missingTeam.push(m);
        continue;
      }
      const info = insert.run(m.alias, m.teamId, source);
      if (info.changes === 1) inserted += 1;
      else alreadyPresent += 1;
    }
  });
  tx();

  return { inserted, alreadyPresent, missingTeam };
}

function printResult(result: SeedResult, apply: boolean): void {
  const header = apply ? 'Applied' : 'Dry-run plan';
  console.log(`-------- ${header}: seedTeamAliases --------`);
  console.log(`inserted:        ${result.inserted}`);
  console.log(`already present: ${result.alreadyPresent}`);
  if (result.missingTeam.length > 0) {
    console.log(`!! missing team rows (skipped): ${result.missingTeam.length}`);
    for (const m of result.missingTeam) {
      console.log(`    alias="${m.alias}" -> team_id=${m.teamId} (${m.teamName})`);
    }
  }
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const here = dirname(fileURLToPath(import.meta.url));
  const defaultDb = resolve(here, '..', '..', '..', '..', 'data', 'lacrosse.db');
  const dbPath = process.env.DB_PATH ?? defaultDb;
  console.log(`[seedTeamAliases] opening ${dbPath} (${apply ? 'APPLY' : 'dry-run'})`);

  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  const groups: Array<{
    label: string;
    mappings: readonly AliasMapping[];
    source: string;
  }> = [
    { label: 'PIAA_ALIASES', mappings: PIAA_ALIASES, source: ALIAS_SOURCE },
    { label: 'PARSER_ABBREVIATIONS', mappings: PARSER_ABBREVIATIONS, source: PARSER_ABBREV_SOURCE },
  ];

  if (!apply) {
    for (const g of groups) {
      const placeholders = g.mappings.map(() => '?').join(',');
      const present = db
        .prepare(`SELECT alias FROM team_aliases WHERE alias IN (${placeholders})`)
        .all(...g.mappings.map((m) => m.alias)) as Array<{ alias: string }>;
      const presentSet = new Set(present.map((r) => r.alias));
      const wouldInsert = g.mappings.filter((m) => !presentSet.has(m.alias));
      console.log(`-------- Dry-run plan: ${g.label} --------`);
      console.log(`would insert: ${wouldInsert.length} / ${g.mappings.length}`);
      for (const m of wouldInsert) {
        console.log(`  + alias="${m.alias}" -> team_id=${m.teamId} (${m.teamName})`);
      }
    }
    console.log(`\nSKIPPED_AMBIGUOUS (documented, not seeded): ${SKIPPED_AMBIGUOUS.length}`);
    for (const s of SKIPPED_AMBIGUOUS) {
      console.log(`  · ${s.token} — ${s.rationale}`);
    }
    console.log('\n(Dry-run only. Re-run with --apply to write.)');
    db.close();
    return;
  }

  for (const g of groups) {
    const result = seedAliases(db, g.mappings, g.source);
    printResult(result, apply);
    console.log(`(group: ${g.label}, source: ${g.source})\n`);
  }

  const total = (db.prepare('SELECT COUNT(*) AS n FROM team_aliases').get() as { n: number }).n;
  console.log(`team_aliases total: ${total}`);
  db.close();
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
