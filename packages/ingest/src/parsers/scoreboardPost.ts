import type { ParsedAnomaly, ParsedScoreLine } from '@pll/shared';
import { parseScoreLine } from './scoreLine.js';
import { htmlToTextLines } from './text.js';
import { normalizeTeamName } from '../normalize/teamName.js';

export interface ScoreboardGame extends ParsedScoreLine {
  /** Date label as written ("April 21"). Caller resolves to ISO. */
  dateLabel: string;
  /** Section label ("Boys") under which this game appeared. */
  sectionLabel: string;
}

export interface ParsedScoreboardPost {
  games: ScoreboardGame[];
  anomalies: ParsedAnomaly[];
}

/**
 * Walk a scoreboard-post HTML body. The body is segmented by:
 *   - date headers like "Today", "April 21", "April 20"
 *   - section headers like "Boys", "Girls", "Men's D2", "D3", "Women's D1"
 * We keep only games under boys/men's-style sections (we also keep "Boys" itself).
 * Lines containing " at " are unplayed schedule lines — skipped. Lines ending
 * with ", ppd" are postponed — skipped.
 */
export function parseScoreboardPost(html: string): ParsedScoreboardPost {
  const lines = htmlToTextLines(html);
  const games: ScoreboardGame[] = [];
  const anomalies: ParsedAnomaly[] = [];

  let currentDate = '';
  let currentSection = '';
  // boys-eligible: only when section explicitly indicates a boys/men's bracket.
  let isBoys = false;

  for (const line of lines) {
    // Date header? "Today" | "Yesterday" | "April 21" | "April 21, 2026" | "Apr 21".
    if (isDateHeader(line)) {
      currentDate = line.replace(/[:\.]+$/, '').trim();
      currentSection = '';
      isBoys = false;
      continue;
    }

    // Section header? Single short line like "Boys", "Girls", "D2", "Men's D2".
    const section = matchSectionHeader(line);
    if (section) {
      currentSection = section;
      isBoys = sectionIsBoys(section);
      continue;
    }

    // Skip if not currently in a boys section.
    if (!isBoys || !currentDate) continue;

    // Schedule lines (unplayed): contain " at " and no comma+digit score.
    if (/ at /i.test(line) && !/,\s*\d/.test(line)) continue;

    // Postponed lines: skip.
    if (/,\s*ppd\b/i.test(line) || /,\s*postponed\b/i.test(line)) continue;

    // Try to parse as a score line.
    const sl = parseScoreLine(line);
    if (sl.result && !sl.result.postponed) {
      let teamA = sl.result.teamA;
      let teamB = sl.result.teamB;
      try { teamA = normalizeTeamName(teamA); } catch { /* keep raw */ }
      try { teamB = normalizeTeamName(teamB); } catch { /* keep raw */ }
      games.push({
        ...sl.result,
        teamA,
        teamB,
        dateLabel: currentDate,
        sectionLabel: currentSection,
      });
    } else if (sl.anomalies.length && /,\s*\d/.test(line)) {
      // Only flag as anomaly if it really looked like a score line.
      anomalies.push(...sl.anomalies);
    }
  }

  return { games, anomalies };
}

const MONTHS = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';

function isDateHeader(line: string): boolean {
  if (/^Today\b/i.test(line)) return true;
  if (/^Yesterday\b/i.test(line)) return true;
  // "April 21" or "April 21, 2026"
  const re = new RegExp(`^${MONTHS}\\s+\\d{1,2}(?:,\\s*\\d{4})?\\s*\\.?$`, 'i');
  return re.test(line.trim());
}

function matchSectionHeader(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length > 40) return null;
  // Boys / Girls / NLL / MLL / PLL
  if (/^(?:Boys|Girls|NLL|MLL|PLL)\.?$/i.test(trimmed)) return trimmed;
  // Men's D1/D2/D3 / Women's D1/D2/D3 / D1/D2/D3 standalone
  if (/^(?:Men'?s|Women'?s)\s+D[123]\b/i.test(trimmed)) return trimmed;
  if (/^D[123]\b\.?$/i.test(trimmed)) return trimmed;
  // Big 10 Quarterfinals etc — treated as sub-headers under the prior section.
  if (/^Big\s+\d+\b/i.test(trimmed)) return trimmed;
  return null;
}

function sectionIsBoys(section: string): boolean {
  if (/^Boys/i.test(section)) return true;
  if (/^Men'?s/i.test(section)) return false; // college men's — not high school boys
  // NLL/MLL/PLL are pro — not high school boys.
  return false;
}
