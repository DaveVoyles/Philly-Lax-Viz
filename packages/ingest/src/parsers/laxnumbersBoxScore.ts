// laxnumbersBoxScore.ts — Parser for LaxNumbers individual game box-score pages.
//
// STATUS: Scaffold only. Requires manual research to determine:
//   1. Whether the scoreboard API returns a game_id field (not in current LaxRawGame type)
//   2. The actual URL pattern for game pages (likely https://laxnumbers.com/game/{id})
//   3. Whether the page serves JSON or requires HTML parsing
//
// Once the URL pattern is known, add an HTML fixture to fixtures/ and flesh out
// the parser logic below.

export interface BoxScorePlayerStat {
  playerName: string;
  goals: number;
  assists: number;
  groundBalls: number;
  causedTurnovers: number;
  saves: number;
  faceoffWon: number;
  faceoffTaken: number;
}

export interface ParsedBoxScore {
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  date: string;
  homePlayers: BoxScorePlayerStat[];
  awayPlayers: BoxScorePlayerStat[];
}

export interface BoxScoreParseResult {
  result: ParsedBoxScore | null;
  anomalies: Array<{ kind: string; detail: string }>;
}

/**
 * Parse a LaxNumbers game page into structured box-score data.
 *
 * TODO: Implement once we have a sample game page (HTML or JSON).
 * Steps to complete:
 *   1. Run `pnpm ingest --source=laxnumbers --date=2026-04-15 --apply` and log
 *      the raw API response to check for a game_id or game_url field
 *   2. Visit a game page in a browser and save the HTML to fixtures/
 *   3. Implement this parser against that fixture
 *   4. Write tests in parsers/__tests__/laxnumbersBoxScore.test.ts
 */
export function parseBoxScore(_html: string): BoxScoreParseResult {
  // Placeholder — returns empty result until we have fixture data
  return {
    result: null,
    anomalies: [{ kind: 'not_implemented', detail: 'Box score parser not yet implemented' }],
  };
}
