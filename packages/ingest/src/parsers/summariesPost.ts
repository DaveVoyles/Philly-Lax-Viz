import type {
  ParsedAnomaly,
  ParsedPlayerStat,
  ParsedQuarterLine,
  ParsedScoreLine,
} from '@pll/shared';
import { parseScoreLine } from './scoreLine.js';
import { parseQuarterLine } from './quarterLine.js';
import { parsePlayerStatLine } from './playerStat.js';
import { parseAggregatedList } from './aggregatedList.js';
import { htmlToTextLines } from './text.js';
import { normalizeTeamName } from '../normalize/teamName.js';

export interface ParsedSummariesGameBlock {
  scoreLine: ParsedScoreLine;
  periods: ParsedQuarterLine[];
  playerStats: ParsedPlayerStat[];
  /**
   * Parallel array to `playerStats`: the most recent sub-header text observed
   * before each stat line, or `null` if no sub-header had appeared yet in the
   * block (in which case the consumer should default to the home team).
   *
   * Wave 12 Lane 1 (Darth 😈⚡): the previous architecture re-walked
   * `rawLines` in `summaries.ts` with its own `looksLikePlayer` heuristic to
   * map stats back to sub-headers. That heuristic disagreed with
   * `parsePlayerStatLine` on inputs like `"Andrew Murray: 8/14 F/O"`, causing
   * `psIdx` desync and producing 148 NULL_HEADER anomalies. Recording the
   * hint at parse time eliminates the parallel walk entirely.
   */
  playerStatTeamHints: (string | null)[];
  /** raw lines that comprised this block (for anomaly attribution / debug) */
  rawLines: string[];
}

export interface ParsedSummariesPost {
  games: ParsedSummariesGameBlock[];
  anomalies: ParsedAnomaly[];
}

const SCORE_LINE_PROBE = /^[A-Za-z][^,:=\d]*\d+\s*,\s*[A-Za-z][^,:=\d]*\d+/;
// Comma-less probe: title-cased team + int + title-cased team + int.
// Mirrors SCORE_RE_NOCOMMA in scoreLine.ts but kept loose enough to be a probe;
// parseScoreLine performs the strict match. Allows an optional `(XX)` state
// suffix on either team (Wave 12 Lane 1 — Darth 😈⚡).
const SCORE_LINE_PROBE_NOCOMMA =
  /^[A-Z][A-Za-z'.\-]*(?:\s+[A-Za-z'.\-]+)*(?:\s*\([A-Z]{2,3}\))?\s+\d+\s+[A-Z][A-Za-z'.\-]*(?:\s+[A-Za-z'.\-]+)*(?:\s*\([A-Z]{2,3}\))?\s+\d+\.?$/;

/**
 * Walk a summaries-post HTML body. Split into game blocks at every line that
 * parses as a score-line; subsequent lines until the next score-line are
 * either quarter lines, an aggregated list, or per-player stat lines.
 */
export function parseSummariesPost(html: string): ParsedSummariesPost {
  const lines = htmlToTextLines(html);
  const games: ParsedSummariesGameBlock[] = [];
  const anomalies: ParsedAnomaly[] = [];

  let current: ParsedSummariesGameBlock | null = null;
  let knownTeams: [string, string] | null = null;
  // Most recent sub-header line (raw, untrimmed) seen since the last score
  // line — recorded onto each player stat as it's pushed so the pipeline can
  // attribute it without re-walking. `null` until the first sub-header in the
  // block, in which case stats default to the home team.
  let currentSubHeader: string | null = null;
  // Aggregated-list lines carry their own team mention in the header. We pass
  // that through as the hint for each item produced by the line.
  // Sub-header detection regex (matches "Devon Prep", "O'Hara", "DV Scoring:",
  // "Penn Charter", etc.) — bare team-ish word(s) optionally followed by a
  // single trailing colon.
  const SUB_HEADER_RE = /^[A-Za-z][A-Za-z'.\-\s&]*\s*:?$/;

  for (const line of lines) {
    // 1. Score line? Start a new block.
    if (SCORE_LINE_PROBE.test(line) || SCORE_LINE_PROBE_NOCOMMA.test(line)) {
      const sl = parseScoreLine(line);
      if (sl.result) {
        if (sl.result.postponed) {
          // Skip postponed games entirely.
          current = null;
          knownTeams = null;
          currentSubHeader = null;
          continue;
        }
        let teamA = sl.result.teamA;
        let teamB = sl.result.teamB;
        try { teamA = normalizeTeamName(teamA); } catch { /* keep raw */ }
        try { teamB = normalizeTeamName(teamB); } catch { /* keep raw */ }
        const normalized: ParsedScoreLine = { ...sl.result, teamA, teamB };
        current = {
          scoreLine: normalized,
          periods: [],
          playerStats: [],
          playerStatTeamHints: [],
          rawLines: [line],
        };
        knownTeams = [teamA, teamB];
        currentSubHeader = null;
        games.push(current);
        continue;
      }
      // If parseScoreLine itself rejected, fall through to other strategies.
      anomalies.push(...sl.anomalies);
    }

    if (!current || !knownTeams) {
      // Lines outside any game block (intro paragraphs, ads). Skip silently.
      continue;
    }
    current.rawLines.push(line);

    // 2. Aggregated-list line? "<Team> goals: ..."
    const aggHeaderMatch = line.match(
      /^([A-Za-z][A-Za-z'.\-\s&]*?)\s+(?:goals?|assists?|saves?|gbs?|ground\s*balls?|ctos?)\s*:/i,
    );
    if (aggHeaderMatch) {
      const agg = parseAggregatedList(line);
      if (agg.results.length > 0) {
        const aggTeamMention = (aggHeaderMatch[1] ?? '').trim();
        for (const r of agg.results) {
          current.playerStats.push(r);
          current.playerStatTeamHints.push(aggTeamMention || currentSubHeader);
        }
        continue;
      }
      anomalies.push(...agg.anomalies);
      continue;
    }

    // 3. Quarter line? Heuristic: starts with text + then mostly numeric tokens
    //    separated by space/dash/comma/equals, and contains no stat tokens.
    if (looksLikeQuarterLine(line)) {
      const ql = parseQuarterLine(line, knownTeams);
      if (ql.result) {
        current.periods.push(ql.result);
        anomalies.push(...ql.anomalies);
        continue;
      }
      anomalies.push(...ql.anomalies);
      // fall through: maybe it's actually a player line
    }

    // 4. Team subsection header? Bare team name with no digits — record as
    //    hint for subsequent stats and move on.
    if (SUB_HEADER_RE.test(line) && line.length < 60) {
      currentSubHeader = line;
      continue;
    }

    // 5. Player stat line.
    const ps = parsePlayerStatLine(line);
    if (ps.result) {
      current.playerStats.push(ps.result);
      current.playerStatTeamHints.push(currentSubHeader);
      continue;
    }
    // Don't spam anomalies for noise lines (e.g. coach quotes). Only if the
    // line clearly attempted to be a stat (had digits + a stat token shape).
    if (/\d/.test(line) && /\b(?:g|a|gb|sv|fo|cto|goal|assist|save)\b/i.test(line)) {
      anomalies.push(...ps.anomalies);
    }
  }

  return { games, anomalies };
}

function looksLikeQuarterLine(line: string): boolean {
  // Must contain a sequence of integers separated by space/-/,/=  with no stat
  // tokens (g, a, gb, sv, etc.) and no parens.
  if (/\(/.test(line)) return false;
  if (/\b(?:goal|assist|save|sv|gb|cto|fo)s?\b/i.test(line)) return false;
  if (!/\d/.test(line)) return false;
  // Need at least 3 integers (>=2 periods + total) for a quarter line.
  const ints = line.match(/\d+/g) ?? [];
  if (ints.length < 3) return false;
  // Must have a separator pattern between digits (space, -, ,, =, en-dash, em-dash).
  return /\d[\s\-–—=,.]+\d/.test(line);
}
