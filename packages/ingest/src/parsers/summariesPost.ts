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
// parseScoreLine performs the strict match.
const SCORE_LINE_PROBE_NOCOMMA =
  /^[A-Z][A-Za-z'.\-]*(?:\s+[A-Za-z'.\-]+)*\s+\d+\s+[A-Z][A-Za-z'.\-]*(?:\s+[A-Za-z'.\-]+)*\s+\d+\.?$/;

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

  for (const line of lines) {
    // 1. Score line? Start a new block.
    if (SCORE_LINE_PROBE.test(line) || SCORE_LINE_PROBE_NOCOMMA.test(line)) {
      const sl = parseScoreLine(line);
      if (sl.result) {
        if (sl.result.postponed) {
          // Skip postponed games entirely.
          current = null;
          knownTeams = null;
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
          rawLines: [line],
        };
        knownTeams = [teamA, teamB];
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
    if (/^[A-Za-z][A-Za-z'.\-\s&]*\s+(?:goals?|assists?|saves?|gbs?|ground\s*balls?|ctos?)\s*:/i.test(line)) {
      const agg = parseAggregatedList(line);
      if (agg.results.length > 0) {
        current.playerStats.push(...agg.results);
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

    // 4. Team subsection header? Bare team name with no digits — skip.
    if (/^[A-Za-z][A-Za-z'.\-\s&]*$/.test(line) && line.length < 60) {
      continue;
    }

    // 5. Player stat line.
    const ps = parsePlayerStatLine(line);
    if (ps.result) {
      current.playerStats.push(ps.result);
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
