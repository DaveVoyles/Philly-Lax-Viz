import type { ParseListResult, ParsedPlayerStat } from '@pll/shared';
import { normalizeUnicodeQuotes, normalizeWhitespace } from './text.js';

const NAME_CHARS = "A-Za-z'.\\-";

/**
 * Parse a "count-first" aggregated list line. Examples:
 *   "Easton goals: 4 Oran Prentice, 3 Sean McPeek, 1 Tomko"
 *   "Parkland Goals: Arezzi 3, Tapia 2, Gerancher, Fisher, Scott"
 *   "Easton assists: 4 Sean McPeek, 4 Evan Placotaris"
 *
 * The header `<Team> <statName>:` determines which bucket each entry goes in.
 * Each comma-separated item is one of:
 *   - "<count> <name>"   ← canonical
 *   - "<name> <count>"   ← Parkland-style
 *   - "<name>"           ← implicit count = 1
 */
export function parseAggregatedList(rawLine: string): ParseListResult<ParsedPlayerStat> {
  const line = normalizeWhitespace(normalizeUnicodeQuotes(rawLine));
  if (!line) return { results: [], anomalies: [] };

  const header = line.match(
    /^([A-Za-z][A-Za-z'.\-\s&]*?)\s+(goals?|assists?|saves?|ground\s*balls?|gbs?|ctos?)\s*:?\s+(.+)$/i,
  );
  if (!header) {
    return {
      results: [],
      anomalies: [
        {
          rawLine,
          strategyAttempted: 'aggregated-list',
          reason: 'no "<team> <stat>:" header recognized',
        },
      ],
    };
  }

  const statTok = (header[2] ?? '').toLowerCase().replace(/\s+/g, '');
  const body = header[3] ?? '';
  const items = body.split(',').map(s => s.trim()).filter(Boolean);

  const results: ParsedPlayerStat[] = [];
  const anomalies: ParseListResult<ParsedPlayerStat>['anomalies'] = [];

  for (const item of items) {
    // Try "<count> <name>" first, then "<name> <count>", then bare name.
    let count = 1;
    let name = '';

    const leadCount = item.match(new RegExp(`^(\\d+)\\s+([${NAME_CHARS}][${NAME_CHARS}\\s]*)$`, 'u'));
    const trailCount = item.match(new RegExp(`^([${NAME_CHARS}][${NAME_CHARS}\\s]*?)\\s+(\\d+)$`, 'u'));
    const bareName = item.match(new RegExp(`^[${NAME_CHARS}][${NAME_CHARS}\\s]*$`, 'u'));

    if (leadCount) {
      count = Number(leadCount[1]);
      name = (leadCount[2] ?? '').trim();
    } else if (trailCount) {
      name = (trailCount[1] ?? '').trim();
      count = Number(trailCount[2]);
    } else if (bareName) {
      name = item;
      count = 1;
    } else {
      anomalies.push({
        rawLine: item,
        strategyAttempted: 'aggregated-list',
        reason: `aggregated-list item did not match <count> <name> | <name> <count> | <name>`,
      });
      continue;
    }

    const stat: ParsedPlayerStat = {
      name,
      goals: 0,
      assists: 0,
      groundBalls: 0,
      causedTurnovers: 0,
      saves: 0,
      foWon: 0,
      foTaken: 0,
      isPartialName: !/\s/.test(name),
      confidence: 0.7,
    };
    if (statTok === 'goal' || statTok === 'goals') stat.goals = count;
    else if (statTok === 'assist' || statTok === 'assists') stat.assists = count;
    else if (statTok === 'save' || statTok === 'saves') stat.saves = count;
    else if (statTok === 'gb' || statTok === 'gbs' || statTok === 'groundball' || statTok === 'groundballs')
      stat.groundBalls = count;
    else if (statTok === 'cto' || statTok === 'ctos') stat.causedTurnovers = count;

    results.push(stat);
  }

  return { results, anomalies };
}
