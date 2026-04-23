/**
 * scanCareerProse — Wave 1 Lane 2 (Yoda) of the 2026-04-22 anomaly hunt.
 *
 * READ-ONLY scan: re-reads cached 2026 boys summary/scoreboard posts from
 * data/raw-cache/<post-id>.html (driven off the raw_cache_meta table) and
 * looks for player-stat lines whose trailing parentheticals smell like
 * career/historical prose. Cross-references each suspect against
 * player_stats to bucket findings:
 *
 *   - parsed-and-clean   : matching row exists, stats look reasonable
 *   - parsed-and-suspect : matching row exists AND the parsed stats include
 *                         the prose number (or a value that suggests the
 *                         parser bled the milestone count into the per-game
 *                         total). NEEDS REMEDIATION.
 *   - not-parsed         : line wasn't successfully parsed (no row found)
 *
 * Casts a deliberately WIDE net — orchestrator/Wave 2 will tune the prod
 * PROSE_MARKERS list in packages/ingest/src/parsers/text.ts based on what
 * this script surfaces.
 *
 * Output: .github/docs/2026-04-22-prose-scan-report.json + stdout summary.
 *
 * Usage:
 *   DB_PATH="$PWD/data/lacrosse.db" \
 *     pnpm --filter @pll/ingest exec tsx \
 *     src/scripts/scanCareerProse.ts
 *
 * Does NOT mutate the DB. Does NOT re-fetch. Does NOT modify text.ts.
 */
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { htmlToTextLines } from '../parsers/text.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DB_PATH = process.env.DB_PATH ?? resolve(process.cwd(), 'data/lacrosse.db');
// DB lives at <repo>/data/lacrosse.db, so two `..` from the DB gets us to repo root
// regardless of where pnpm/tsx set process.cwd().
const REPO_ROOT = resolve(dirname(DB_PATH), '..');
const CACHE_DIR = join(REPO_ROOT, 'data', 'raw-cache');
const REPORT_PATH = join(
  REPO_ROOT,
  '.github',
  'docs',
  '2026-04-22-prose-scan-report.json',
);

/**
 * EXPANDED prose markers — wider net than text.ts PROSE_MARKERS. Anything
 * matching these inside a parenthetical or nearby fragment is a candidate
 * for being career/historical narration rather than per-game stats.
 */
const EXPANDED_PROSE_MARKERS = [
  // text.ts current set (kept for parity)
  'career',
  'season',
  'school record',
  'state record',
  'all[- ]?time',
  'milestone',
  'now has',
  'now with',
  'set [a-z]+ record',
  'broke',
  'broken',
  'reached',
  'on (his|her|the)',
  'for (his|her|the)',
  'in (his|her|the)',
  'lifetime',
  'overall',
  'committed',
  'commit',
  'signed',
  // Yoda's expanded set
  'tied',
  'ties',
  'previous',
  'former',
  'earlier',
  'matched',
  'surpass(?:es|ed)?',
  'pass(?:es|ed)',
  'reach(?:es|ed)',
  'notch(?:es|ed)',
  'tally',
  'record-tying',
  'record-setting',
  'history',
  'all-time leader',
  'leader[s]?',
  'hat trick',
  'four-goal',
  'five-goal',
  'six-goal',
  'standout',
  'star',
  'veteran',
  'senior',
  'junior',
  'sophomore',
  'freshman',
  // Discovered while spot-checking the cache
  '\\brecord\\b',
  '\\bpoint(?:s)?\\b',
  '\\bgoal(?:s)?\\b(?=[^)]*\\b(?:career|season|all|history|record|leader|tied)\\b)',
  'become[s]? .*leader',
  'first[- ]team',
  'all[- ](?:state|league|county|conference|america|american)',
  'won the',
  '\\bMVP\\b',
  'program record',
  'school[- ]?record',
  'first career',
  '1st career',
  '\\d{2,3}(?:st|nd|rd|th)\\s+(?:career|point|goal|save|assist|gb|ground|face)',
  'saves on the',
  'goals on the',
  'points on the',
];
const EXPANDED_PROSE_RE = new RegExp(
  `(?:${EXPANDED_PROSE_MARKERS.join('|')})`,
  'i',
);

/** Per-game stat-cap thresholds — same semantics as auditStatAnomalies.ts. */
const STAT_CAPS: Record<string, number> = {
  goals: 15,
  assists: 15,
  ground_balls: 30,
  caused_turnovers: 20,
  saves: 40,
  fo_won: 40,
  fo_taken: 50,
};

// Threshold above which any number inside a parenthetical (alongside a
// stat-line head) is independently suspicious, regardless of marker words.
const PAREN_BIG_NUMBER = 25;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CacheRow {
  post_id: string;
  url: string;
}

interface PlayerStatRow {
  ps_id: number;
  game_id: number;
  player_id: number;
  player_name: string;
  goals: number;
  assists: number;
  ground_balls: number;
  caused_turnovers: number;
  saves: number;
  fo_won: number;
  fo_taken: number;
}

interface SuspectFinding {
  category: 'parsed-and-suspect' | 'parsed-and-clean' | 'not-parsed';
  source_post_id: string;
  source_url: string;
  raw_line: string;
  player_name_guess: string;
  parenthetical: string;
  paren_numbers: number[];
  matched_marker: string | null;
  reason: string;
  matched_stat_rows: Array<{
    player_id: number;
    player_name: string;
    game_id: number;
    goals: number;
    assists: number;
    ground_balls: number;
    caused_turnovers: number;
    saves: number;
    fo_won: number;
    fo_taken: number;
    suspect_columns: string[];
  }>;
  suggested_action: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True if URL/post-id looks like a 2026 boys summary or scoreboard post. */
function isBoysSummaryPost(url: string, postId: string): boolean {
  const u = url.toLowerCase();
  const p = postId.toLowerCase();
  if (!u.includes('/2026/')) return false;
  // We want boys summaries / boys scoreboards. Skip explicitly girls/women.
  if (/\b(girls|women|wlax)\b/.test(p)) return false;
  return /(boys[-_]?(?:summari|scoreboard|recap)|hs[-_]?boys[-_]?summari)/.test(p);
}

/** Looks like the head of a stat line: "Lastname 3g" / "First Lastname 2g, 1a". */
const STAT_HEAD_RE = /\b([A-Z][A-Za-z'’\-]{1,}(?:\s+[A-Z][A-Za-z'’\-]+)?)\s*[-–.,]?\s*(\d{1,3})\s*(?:g|a|gb|sv|cto|fo|goal|assist|save|ground)\b/i;

/** Extract numbers >= 1 from a string. */
function numbersIn(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(/\b(\d{1,4})\b/g)) {
    out.push(Number(m[1]));
  }
  return out;
}

/** Normalize a name fragment for fuzzy matching against players.name. */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9 \-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  if (!existsSync(DB_PATH)) {
    throw new Error(`DB not found at ${DB_PATH}`);
  }
  const db = new Database(DB_PATH, { readonly: true });

  // 1. Pull boys-summary posts from the cache index.
  const allCache = db
    .prepare<[], CacheRow>('SELECT post_id, url FROM raw_cache_meta')
    .all();
  const targetPosts = allCache.filter((r) => isBoysSummaryPost(r.url, r.post_id));

  console.log(
    `[scanCareerProse] cache rows: ${allCache.length}; boys-summary candidates: ${targetPosts.length}`,
  );

  // Pre-prepare lookup statements.
  const lookupStatsByGameAndSurname = db.prepare<
    [string, string],
    PlayerStatRow
  >(`
    SELECT
      ps.id            AS ps_id,
      ps.game_id       AS game_id,
      ps.player_id     AS player_id,
      p.name           AS player_name,
      ps.goals, ps.assists, ps.ground_balls, ps.caused_turnovers,
      ps.saves, ps.fo_won, ps.fo_taken
    FROM player_stats ps
    JOIN players p ON p.id = ps.player_id
    JOIN games g   ON g.id = ps.game_id
    WHERE g.source_post_id = ?
      AND lower(p.name_normalized) LIKE ?
  `);

  const lookupGamesForPost = db.prepare<[string], { id: number }>(
    `SELECT id FROM games WHERE source_post_id = ?`,
  );

  const findings: SuspectFinding[] = [];
  let postsScanned = 0;
  let postsMissingHtml = 0;
  let suspectLines = 0;

  for (const post of targetPosts) {
    const htmlPath = join(CACHE_DIR, `${post.post_id}.html`);
    if (!existsSync(htmlPath)) {
      postsMissingHtml++;
      continue;
    }
    postsScanned++;

    const html = readFileSync(htmlPath, 'utf8');
    let lines: string[];
    try {
      lines = htmlToTextLines(html);
    } catch (err) {
      console.warn(`  ! failed to parse ${post.post_id}: ${(err as Error).message}`);
      continue;
    }

    // Cache games for this post for the not-parsed check.
    const gameIdsForPost = new Set(
      lookupGamesForPost.all(post.post_id).map((r) => r.id),
    );

    for (const line of lines) {
      // 1) must look like a stat line.
      const head = line.match(STAT_HEAD_RE);
      if (!head) continue;
      const surnameGuess = head[1] ?? '';
      if (!surnameGuess) continue;

      // 2) find every parenthetical and decide if any are suspect.
      const parens = Array.from(line.matchAll(/\(([^()]+)\)/g));
      if (parens.length === 0) continue;

      let suspectParen: string | null = null;
      let matchedMarker: string | null = null;
      let suspectNumbers: number[] = [];
      let reason = '';

      for (const p of parens) {
        const inner = p[1] ?? '';
        const markerMatch = inner.match(EXPANDED_PROSE_RE);
        const nums = numbersIn(inner);
        const bigNums = nums.filter((n) => n >= PAREN_BIG_NUMBER);

        if (markerMatch) {
          suspectParen = inner;
          matchedMarker = markerMatch[0];
          suspectNumbers = nums;
          reason = `prose marker "${markerMatch[0]}" inside parenthetical`;
          break;
        }
        if (bigNums.length > 0) {
          suspectParen = inner;
          matchedMarker = null;
          suspectNumbers = nums;
          reason = `parenthetical contains big number(s) ${bigNums.join(',')} (>= ${PAREN_BIG_NUMBER}) alongside stat-line head`;
          break;
        }
      }

      if (!suspectParen) continue;
      suspectLines++;

  // Improve surname extraction: the captured group may include the first name,
  // so use the *last* whitespace-separated token as the surname for matching.
  const tokens = surnameGuess.split(/\s+/);
  const surnameOnly = tokens[tokens.length - 1] ?? surnameGuess;
  const surnameLike = `%${normalizeName(surnameOnly)}%`;
      const candidates = lookupStatsByGameAndSurname.all(post.post_id, surnameLike);

      // Identify "smoking gun" rows: stored stat that equals one of the
      // parenthetical numbers OR exceeds the per-game cap.
      const matchedRows = candidates.map((r) => {
        const suspectColumns: string[] = [];
        for (const [col, cap] of Object.entries(STAT_CAPS)) {
          const v = (r as unknown as Record<string, number>)[col] ?? 0;
          if (v > cap) suspectColumns.push(`${col}=${v}>cap${cap}`);
          if (suspectNumbers.includes(v) && v >= 5)
            suspectColumns.push(`${col}=${v}==paren#`);
          // Bleed-through pattern: if line has "1G (... 173 ...)" we'd see 174
          // stored. So check for stat == (paren_num + small_int).
          for (const pn of suspectNumbers.filter((n) => n >= 20)) {
            if (v >= pn && v <= pn + 10 && v > cap) {
              suspectColumns.push(`${col}=${v}≈paren${pn}+small`);
            }
          }
        }
        return {
          player_id: r.player_id,
          player_name: r.player_name,
          game_id: r.game_id,
          goals: r.goals,
          assists: r.assists,
          ground_balls: r.ground_balls,
          caused_turnovers: r.caused_turnovers,
          saves: r.saves,
          fo_won: r.fo_won,
          fo_taken: r.fo_taken,
          suspect_columns: Array.from(new Set(suspectColumns)),
        };
      });

      let category: SuspectFinding['category'];
      let suggested_action: string;

      if (candidates.length === 0) {
        category = 'not-parsed';
        suggested_action =
          'No matching player_stats row — parser likely already skipped this line. No action.';
      } else if (matchedRows.some((r) => r.suspect_columns.length > 0)) {
        category = 'parsed-and-suspect';
        suggested_action =
          'Re-ingest this post with the hardened parser (or clamp the offending column via auditStatAnomalies.ts). The stored value matches/exceeds the parenthetical milestone number.';
      } else {
        category = 'parsed-and-clean';
        suggested_action =
          'Stats look reasonable — parser likely stripped the parenthetical correctly. No action; useful as a regression fixture.';
      }

      findings.push({
        category,
        source_post_id: post.post_id,
        source_url: post.url,
        raw_line: line,
        player_name_guess: surnameGuess,
        parenthetical: suspectParen,
        paren_numbers: suspectNumbers,
        matched_marker: matchedMarker,
        reason,
        matched_stat_rows: matchedRows,
        suggested_action,
      });

      // (gameIdsForPost reference avoids unused-var lint when not-parsed branch
      // doesn't fire — keeps the variable in scope for future filtering.)
      void gameIdsForPost;
    }
  }

  // ---- Summarize ----
  const byCategory: Record<string, number> = {
    'parsed-and-suspect': 0,
    'parsed-and-clean': 0,
    'not-parsed': 0,
  };
  for (const f of findings) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;

  // Marker frequency (only counted when a marker actually fired).
  const markerFreq: Record<string, number> = {};
  for (const f of findings) {
    if (!f.matched_marker) continue;
    const k = f.matched_marker.toLowerCase();
    markerFreq[k] = (markerFreq[k] ?? 0) + 1;
  }
  const topMarkers = Object.entries(markerFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);

  const report = {
    generated_at: new Date().toISOString(),
    db_path: DB_PATH,
    posts_scanned: postsScanned,
    posts_missing_html: postsMissingHtml,
    boys_summary_posts_total: targetPosts.length,
    suspect_lines_total: suspectLines,
    findings_by_category: byCategory,
    top_markers: topMarkers,
    expanded_prose_markers_used: EXPANDED_PROSE_MARKERS,
    paren_big_number_threshold: PAREN_BIG_NUMBER,
    findings,
  };

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log('');
  console.log('=== scanCareerProse summary ===');
  console.log(`posts_scanned             : ${postsScanned}`);
  console.log(`posts_missing_html        : ${postsMissingHtml}`);
  console.log(`boys_summary_posts_total  : ${targetPosts.length}`);
  console.log(`suspect_lines_total       : ${suspectLines}`);
  console.log(`  parsed-and-suspect      : ${byCategory['parsed-and-suspect']}`);
  console.log(`  parsed-and-clean        : ${byCategory['parsed-and-clean']}`);
  console.log(`  not-parsed              : ${byCategory['not-parsed']}`);
  console.log(`top markers (count)       :`);
  for (const [m, c] of topMarkers.slice(0, 10)) {
    console.log(`  ${c.toString().padStart(4)}  ${m}`);
  }
  console.log(`report written to         : ${REPORT_PATH}`);

  db.close();
}

main();
