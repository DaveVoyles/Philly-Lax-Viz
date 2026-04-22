import type { ParseListResult, ParsedRankingEntry, RankingSource } from '@pll/shared';
import { htmlToTextLines } from './text.js';
import { normalizeTeamName } from '../normalize/teamName.js';

/**
 * Parse a ranking-list HTML body. We expect lines of the form:
 *   "1. Spring-Ford"
 *   "2) Boyertown (last week: 4)"
 *   "3 Easton"
 * Trailing parentheticals (last week, record, etc.) are discarded.
 */
export function parseRankingList(
  html: string,
  opts: { rankingSource: RankingSource; postUrl: string },
): ParseListResult<ParsedRankingEntry> {
  void opts.postUrl;
  const lines = htmlToTextLines(html);
  const results: ParsedRankingEntry[] = [];
  const anomalies: ParseListResult<ParsedRankingEntry>['anomalies'] = [];

  // weekStart isn't derivable from the body alone — caller must overwrite if
  // they have it; we default to empty string and let the orchestrator set it.
  const weekStart = '';

  for (const raw of lines) {
    const m = raw.match(/^(\d{1,3})\s*[\.\)\-:]?\s+(.+)$/);
    if (!m) continue;
    const rank = Number(m[1]);
    if (!Number.isFinite(rank) || rank < 1 || rank > 100) continue;
    let teamName = (m[2] ?? '').trim();
    // Strip a trailing record like " 12-2".
    teamName = teamName.replace(/\s+\d+-\d+(?:-\d+)?$/u, '').trim();
    // Canonicalize: drops noise parentheticals like "(1)", "(MAPL)",
    // "(District 12)" while preserving out-of-state markers like "(NJ)".
    try {
      teamName = normalizeTeamName(teamName);
    } catch {
      teamName = '';
    }
    if (!teamName) {
      anomalies.push({
        rawLine: raw,
        strategyAttempted: 'ranking-list',
        reason: 'rank found but team name empty',
      });
      continue;
    }
    results.push({ rank, teamName, weekStart, rankingSource: opts.rankingSource });
  }

  if (results.length === 0) {
    anomalies.push({
      rawLine: '',
      strategyAttempted: 'ranking-list',
      reason: 'no ranking entries found in body',
    });
  }

  return { results, anomalies };
}
