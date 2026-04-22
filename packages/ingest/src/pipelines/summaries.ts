// summaries.ts — given a parsed summaries post, upsert teams + games +
// game_periods + players + player_stats; emit anomalies.
//
// Reconciliation: when a (date, home, away) tuple already exists (created by
// the scoreboard pipeline), we keep the existing scores (scoreboard is
// authoritative) and only attach the recap_url + parsed_at refresh.

import type { Database } from 'better-sqlite3';
import type { ParsedPlayerStat } from '@pll/shared';
import { PARSER_VERSION } from '@pll/shared';
import type { ParsedSummariesPost } from '../parsers/summariesPost.js';
import { normalizeTeamName, resolveTeam, findTeamByName, type TeamRow } from './teamResolver.js';
import { normalizePlayerName } from '../normalize/playerName.js';
import { insertAnomaly } from './anomalies.js';

export interface SummariesPipelineInput {
  postId: string;
  postUrl: string;
  postDate: string; // ISO YYYY-MM-DD; used as game date for all blocks
  parsed: ParsedSummariesPost;
}

export interface SummariesPipelineResult {
  gamesUpserted: number;
  periodsUpserted: number;
  playersUpserted: number;
  playerStatsUpserted: number;
  anomaliesAdded: number;
}

interface ExistingGameRow {
  id: number;
  home_team_id: number;
  away_team_id: number;
}

/** Lowercased, accent-stripped, whitespace-collapsed name for player dedupe. */
// Inline normalizer removed in Wave 4 — see normalizePlayerName imported from
// ../normalize/playerName.js (Chewy 🐻💪 audit, Appendix A.5 #4).

export function ingestSummariesPost(
  db: Database,
  input: SummariesPipelineInput,
): SummariesPipelineResult {
  const now = new Date().toISOString();
  const r: SummariesPipelineResult = {
    gamesUpserted: 0,
    periodsUpserted: 0,
    playersUpserted: 0,
    playerStatsUpserted: 0,
    anomaliesAdded: 0,
  };

  const insertGame = db.prepare(
    `INSERT INTO games
       (date, home_team_id, away_team_id, home_score, away_score,
        ot_periods, postponed, source_post_id, recap_url, parsed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date, home_team_id, away_team_id) DO UPDATE SET
       ot_periods = excluded.ot_periods,
       recap_url  = COALESCE(games.recap_url, excluded.recap_url),
       parsed_at  = excluded.parsed_at`,
  );
  const selectGame = db.prepare(
    `SELECT id, home_team_id, away_team_id FROM games
     WHERE date = ? AND home_team_id = ? AND away_team_id = ?`,
  );

  const upsertPeriod = db.prepare(
    `INSERT INTO game_periods (game_id, team_id, period_number, goals)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(game_id, team_id, period_number) DO UPDATE SET
       goals = excluded.goals`,
  );

  const upsertPlayer = db.prepare(
    `INSERT INTO players (name, name_normalized, team_id, name_resolution)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(team_id, name_normalized) DO UPDATE SET
       name = CASE
         WHEN length(excluded.name) > length(players.name) THEN excluded.name
         ELSE players.name
       END,
       name_resolution = CASE
         WHEN excluded.name_resolution = 'full' THEN 'full'
         ELSE players.name_resolution
       END
     RETURNING id`,
  );

  const upsertPlayerStat = db.prepare(
    `INSERT INTO player_stats
       (game_id, player_id, goals, assists, ground_balls, caused_turnovers,
        saves, fo_won, fo_taken, source, parser_version, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'summary', ?, ?)
     ON CONFLICT(game_id, player_id) DO UPDATE SET
       goals            = excluded.goals,
       assists          = excluded.assists,
       ground_balls     = excluded.ground_balls,
       caused_turnovers = excluded.caused_turnovers,
       saves            = excluded.saves,
       fo_won           = excluded.fo_won,
       fo_taken         = excluded.fo_taken,
       parser_version   = excluded.parser_version,
       confidence       = excluded.confidence`,
  );

  for (const block of input.parsed.games) {
    let homeTeam: TeamRow, awayTeam: TeamRow;
    try {
      homeTeam = resolveTeam(db, block.scoreLine.teamA);
      awayTeam = resolveTeam(db, block.scoreLine.teamB);
    } catch (err) {
      r.anomaliesAdded += insertAnomaly(db, {
        sourcePostId: input.postId,
        sourceUrl: input.postUrl,
        rawLine: `${block.scoreLine.teamA} ${block.scoreLine.scoreA}, ${block.scoreLine.teamB} ${block.scoreLine.scoreB}`,
        parentGameId: null,
        strategyAttempted: 'score-line',
        reason: `team resolution failed: ${(err as Error).message}`,
      });
      continue;
    }
    if (homeTeam.id === awayTeam.id) {
      r.anomaliesAdded += insertAnomaly(db, {
        sourcePostId: input.postId,
        sourceUrl: input.postUrl,
        rawLine: `${block.scoreLine.teamA} vs ${block.scoreLine.teamB}`,
        parentGameId: null,
        strategyAttempted: 'score-line',
        reason: 'home and away teams resolved to same row',
      });
      continue;
    }

    insertGame.run(
      input.postDate,
      homeTeam.id,
      awayTeam.id,
      block.scoreLine.scoreA,
      block.scoreLine.scoreB,
      block.scoreLine.otPeriods,
      0,
      input.postId,
      input.postUrl,
      now,
    );
    const gameRow = selectGame.get(input.postDate, homeTeam.id, awayTeam.id) as
      | ExistingGameRow
      | undefined;
    if (!gameRow) {
      // Should never happen — ON CONFLICT keeps the row.
      r.anomaliesAdded += insertAnomaly(db, {
        sourcePostId: input.postId,
        sourceUrl: input.postUrl,
        rawLine: `${block.scoreLine.teamA} ${block.scoreLine.scoreA}, ${block.scoreLine.teamB} ${block.scoreLine.scoreB}`,
        parentGameId: null,
        strategyAttempted: 'score-line',
        reason: 'game upsert returned no row',
      });
      continue;
    }
    r.gamesUpserted++;
    const gameId = gameRow.id;

    // Quarter lines.
    for (const period of block.periods) {
      // Resolve the period's teamHint to one of the two teams in the game.
      const hintNorm = normalizeTeamName(period.teamHint);
      let teamId: number | null = null;
      if (hintNorm === normalizeTeamName(block.scoreLine.teamA)) teamId = homeTeam.id;
      else if (hintNorm === normalizeTeamName(block.scoreLine.teamB)) teamId = awayTeam.id;
      else {
        // Last-ditch: see if the hint matches an existing team via alias.
        // Use lookup-only (findTeamByName) to avoid creating ghost team rows
        // from stray abbreviation hints like "DV:" or "AC:".
        const t = findTeamByName(db, period.teamHint);
        if (t) {
          if (t.id === homeTeam.id) teamId = homeTeam.id;
          else if (t.id === awayTeam.id) teamId = awayTeam.id;
        }
      }
      if (teamId === null) {
        r.anomaliesAdded += insertAnomaly(db, {
          sourcePostId: input.postId,
          sourceUrl: input.postUrl,
          rawLine: `quarter line teamHint="${period.teamHint}" did not match ${block.scoreLine.teamA} | ${block.scoreLine.teamB}`,
          parentGameId: gameId,
          strategyAttempted: 'quarter-line',
          reason: 'team hint did not resolve to either side of the score line',
        });
        continue;
      }
      if (!period.validates) {
        r.anomaliesAdded += insertAnomaly(db, {
          sourcePostId: input.postId,
          sourceUrl: input.postUrl,
          rawLine: `${period.teamHint}: ${period.periods.join(',')} != ${period.total}`,
          parentGameId: gameId,
          strategyAttempted: 'quarter-line',
          reason: 'period sum does not equal total — periods stored anyway',
        });
      }
      for (let i = 0; i < period.periods.length; i++) {
        upsertPeriod.run(gameId, teamId, i + 1, period.periods[i]);
        r.periodsUpserted++;
      }
    }

    // Player stats: assign each player to the team whose subsection they
    // appeared under. The parser doesn't track that today, so we use a
    // best-effort heuristic: aggregate-list entries carry a leading team name
    // in the source line (already absorbed into the stat). For player-first
    // entries, we don't know — fall back to the home team and emit an anomaly
    // if the partial-name matches both (we'll let post-pass reconciliation
    // handle this in a future wave). For now, attribute by source position:
    //   - First half of the playerStats array → home, second half → away
    // is fragile; instead we attribute everything to a single "unknown" player
    // bucket would lose data. So: attribute to home when we cannot determine,
    // and flag confidence accordingly.
    //
    // Pragmatic path used here: if a player_stat carries a trailing/leading
    // team marker we honor it; otherwise we use a per-block running team
    // assignment based on order — best-effort, with an anomaly if we have to
    // guess.
    assignAndUpsertPlayerStats({
      db,
      block,
      gameId,
      homeTeam,
      awayTeam,
      input,
      now,
      counters: r,
      upsertPlayer,
      upsertPlayerStat,
    });
  }

  for (const anomaly of input.parsed.anomalies) {
    r.anomaliesAdded += insertAnomaly(db, {
      sourcePostId: input.postId,
      sourceUrl: input.postUrl,
      rawLine: anomaly.rawLine,
      parentGameId: null,
      strategyAttempted: anomaly.strategyAttempted,
      reason: anomaly.reason,
    });
  }

  return r;
}

interface AssignArgs {
  db: Database;
  block: ParsedSummariesPost['games'][number];
  gameId: number;
  homeTeam: TeamRow;
  awayTeam: TeamRow;
  input: SummariesPipelineInput;
  now: string;
  counters: SummariesPipelineResult;
  upsertPlayer: { run: (...p: unknown[]) => unknown; get: (...p: unknown[]) => unknown };
  upsertPlayerStat: { run: (...p: unknown[]) => unknown };
}

/**
 * Attribute player_stat lines to the home or away team. Strategy:
 *
 *   We walk the block's `rawLines` in order. We track which team the parser
 *   most recently saw — initially the home team. When a raw line matches one
 *   of the two team display names (sub-header), we switch the running team.
 *   Each ParsedPlayerStat in `block.playerStats` is assumed to have been
 *   produced in the same line order as `rawLines`, so we re-walk and match by
 *   index.
 *
 *   This isn't perfect, but it captures the common pattern:
 *       "Spring-Ford 10, Boyertown 5"
 *       "Spring-Ford 3 1 5 1 - 10"
 *       "Boyertown 1 0 2 2 - 5"
 *       "Spring-Ford"
 *       "Player A 2g"
 *       ...
 *       "Boyertown"
 *       "Player Z 1g"
 *
 *   When we can't tie a stat line back to a sub-header we attribute to home
 *   and flag the player as low confidence.
 */
function assignAndUpsertPlayerStats(a: AssignArgs): void {
  const { db, block, gameId, homeTeam, awayTeam, input, counters,
    upsertPlayer, upsertPlayerStat } = a;

  const homeNorm = normalizeTeamName(block.scoreLine.teamA);
  const awayNorm = normalizeTeamName(block.scoreLine.teamB);

  // Build a parallel array attributing each playerStat to home, away, or null
  // (null = uncertain; we saw a sub-header that doesn't belong to this game,
  // so we refuse to silently default to home — emit an anomaly instead).
  const attributions: (TeamRow | null)[] = [];
  let currentTeam: TeamRow | null = homeTeam;
  // The parser walks rawLines and pushes into playerStats in encounter order.
  // We replicate that walk here using the same heuristics so our index lines
  // up.
  let psIdx = 0;
  for (const line of block.rawLines) {
    // Sub-header detection (bare team name).
    const trimmed = line.trim();
    if (/^[A-Za-z][A-Za-z'.\-\s&]*$/.test(trimmed) && trimmed.length < 60) {
      const norm = normalizeTeamName(trimmed);
      if (norm === homeNorm) { currentTeam = homeTeam; continue; }
      if (norm === awayNorm) { currentTeam = awayTeam; continue; }
      // Could be a sub-header like "Spring-Ford Scoring" — handled by parser stripping.
      const stripped = norm.replace(/\s+(?:scoring|scorers|stats)$/i, '');
      if (stripped === homeNorm) { currentTeam = homeTeam; continue; }
      if (stripped === awayNorm) { currentTeam = awayTeam; continue; }
      // Try alias resolution against this line — it may be an abbreviation
      // ("TV" -> Twin Valley) for a team NOT in this game. If it resolves to a
      // team that's neither home nor away, this is a strong signal that the
      // post structure transitioned to a new game block that the score-line
      // parser missed (e.g., comma-less score line). Mark currentTeam=null so
      // subsequent player lines become anomalies instead of silently bleeding
      // into the home team's roster. Use lookup-only (findTeamByName) so we
      // don't pollute the teams table with stray abbreviation tokens like
      // "DV" or "AC" that happen to appear as bare lines.
      const t = findTeamByName(db, trimmed);
      if (!t) {
        // Not a known team. Conservative: treat as uncertain boundary marker.
        currentTeam = null;
        continue;
      }
      if (t.id !== homeTeam.id && t.id !== awayTeam.id) {
        currentTeam = null;
        continue;
      }
      currentTeam = t.id === homeTeam.id ? homeTeam : awayTeam;
      continue;
    }
    // Aggregated-list line: "<Team> goals: ..." — switches team for all items
    // produced from this single raw line.
    const aggHeader = trimmed.match(
      /^([A-Za-z][A-Za-z'.\-\s&]*?)\s+(?:goals?|assists?|saves?|gbs?|ground\s*balls?|ctos?)\s*:/i,
    );
    if (aggHeader) {
      const teamMention = normalizeTeamName(aggHeader[1] ?? '');
      const aggTeam: TeamRow | null =
        teamMention === homeNorm ? homeTeam
        : teamMention === awayNorm ? awayTeam
        : currentTeam;
      // Consume all consecutive playerStats produced by this single line. We
      // don't know how many, so we count items by splitting the body.
      const bodyMatch = trimmed.match(/:\s*(.+)$/);
      const itemCount = bodyMatch ? bodyMatch[1]!.split(',').filter((s: string) => s.trim()).length : 0;
      for (let k = 0; k < itemCount && psIdx < block.playerStats.length; k++) {
        attributions[psIdx++] = aggTeam;
      }
      continue;
    }
    // Player-stat line: a single playerStat is produced when the parser
    // matches; we attribute to currentTeam (which may be null = uncertain).
    if (psIdx < block.playerStats.length) {
      // Heuristic: matches lines like "Name 1g", "Name 5g, 2a", "Name 12/13 FO",
      // "Name 3 goals". Looks for digit-adjacent-to-stat-token OR full word.
      const looksLikePlayer =
        /\d\s*(?:g|a|gb|sv|fo|cto|goals?|assists?|saves?|ground\s*balls?)\b/i.test(trimmed) ||
        /\b(?:goals?|assists?|saves?|ground\s*balls?)\b/i.test(trimmed);
      if (looksLikePlayer) {
        attributions[psIdx++] = currentTeam;
      }
    }
  }
  // Backfill: any unattributed slot stays null (uncertain). We will NOT default
  // to home — that was the bug that bled foreign players into Harriton.
  for (let i = 0; i < block.playerStats.length; i++) {
    if (attributions[i] === undefined) attributions[i] = null;
  }

  for (let i = 0; i < block.playerStats.length; i++) {
    const ps: ParsedPlayerStat = block.playerStats[i]!;
    const team = attributions[i];
    if (!team) {
      // Uncertain attribution — refuse to write a stat row that would
      // misattribute a player. Record as anomaly so it surfaces on the
      // data-quality page and can be resolved (often by extending the
      // score-line parser or seeding a team alias).
      counters.anomaliesAdded += insertAnomaly(db, {
        sourcePostId: input.postId,
        sourceUrl: input.postUrl,
        rawLine: `player stat dropped — uncertain team: ${ps.name} ${ps.goals}g ${ps.assists}a`,
        parentGameId: gameId,
        strategyAttempted: 'player-stat-line',
        reason: 'sub-header did not match either game team; likely a score line the parser missed',
      });
      continue;
    }
    const nameNorm = normalizePlayerName(ps.name);
    if (!nameNorm) {
      counters.anomaliesAdded += insertAnomaly(db, {
        sourcePostId: input.postId,
        sourceUrl: input.postUrl,
        rawLine: `player stat with empty normalized name: ${ps.name}`,
        parentGameId: gameId,
        strategyAttempted: 'player-stat-line',
        reason: 'normalized player name is empty',
      });
      continue;
    }
    const playerRow = upsertPlayer.get(
      ps.name,
      nameNorm,
      team.id,
      ps.isPartialName ? 'partial' : 'full',
    ) as { id: number } | undefined;
    if (!playerRow) {
      counters.anomaliesAdded += insertAnomaly(db, {
        sourcePostId: input.postId,
        sourceUrl: input.postUrl,
        rawLine: `player upsert returned no row: ${ps.name}`,
        parentGameId: gameId,
        strategyAttempted: 'player-stat-line',
        reason: 'player upsert returned no id',
      });
      continue;
    }
    counters.playersUpserted++;
    upsertPlayerStat.run(
      gameId,
      playerRow.id,
      ps.goals,
      ps.assists,
      ps.groundBalls,
      ps.causedTurnovers,
      ps.saves,
      ps.foWon,
      ps.foTaken,
      PARSER_VERSION,
      ps.confidence,
    );
    counters.playerStatsUpserted++;
  }
}
