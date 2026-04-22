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
import { normalizeTeamName, normalizeTeamToken, resolveScoreLineTeam, findTeamByName, type TeamRow } from './teamResolver.js';
import { normalizePlayerName } from '../normalize/playerName.js';
import { insertAnomaly } from './anomalies.js';
import { DEFAULT_SEASON } from '../crawler.js';

export interface SummariesPipelineInput {
  postId: string;
  postUrl: string;
  postDate: string; // ISO YYYY-MM-DD; used as game date for all blocks
  /**
   * Season (year) the games belong to — derived from the post URL path. If
   * omitted, defaults to {@link DEFAULT_SEASON} (2026, the W12-and-earlier
   * behavior).
   */
  season?: number;
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
        ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date, home_team_id, away_team_id) DO UPDATE SET
       ot_periods = excluded.ot_periods,
       recap_url  = COALESCE(games.recap_url, excluded.recap_url),
       parsed_at  = excluded.parsed_at,
       season     = excluded.season`,
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
        saves, fo_won, fo_taken, source, parser_version, confidence, season)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'summary', ?, ?, ?)
     ON CONFLICT(game_id, player_id) DO UPDATE SET
       goals            = excluded.goals,
       assists          = excluded.assists,
       ground_balls     = excluded.ground_balls,
       caused_turnovers = excluded.caused_turnovers,
       saves            = excluded.saves,
       fo_won           = excluded.fo_won,
       fo_taken         = excluded.fo_taken,
       parser_version   = excluded.parser_version,
       confidence       = excluded.confidence,
       season           = excluded.season`,
  );

  for (const block of input.parsed.games) {
    let homeTeam: TeamRow | null = null;
    let awayTeam: TeamRow | null = null;
    try {
      // Wave 14 Lane 1 (Yoda 🧙‍♂️🟢): use the layered, insert-guarded
      // resolver. It tries alias → exact-name → partialMatch (initials,
      // word-prefix) before EVER inserting, and refuses to insert short
      // 1-3 char ALL-CAPS tokens that would create ghost teams like "PR".
      homeTeam = resolveScoreLineTeam(db, block.scoreLine.teamA, partialMatchesTeam);
      awayTeam = resolveScoreLineTeam(db, block.scoreLine.teamB, partialMatchesTeam);
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
    if (!homeTeam || !awayTeam) {
      const failed = !homeTeam ? block.scoreLine.teamA : block.scoreLine.teamB;
      r.anomaliesAdded += insertAnomaly(db, {
        sourcePostId: input.postId,
        sourceUrl: input.postUrl,
        rawLine: `${block.scoreLine.teamA} ${block.scoreLine.scoreA}, ${block.scoreLine.teamB} ${block.scoreLine.scoreB}`,
        parentGameId: null,
        strategyAttempted: 'score-line',
        reason: `score-line probe rejected team token "${failed}" (likely a sub-header, not a real team — would create a ghost team)`,
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
      input.season ?? DEFAULT_SEASON,
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
      const cleanedHint = normalizeTeamToken(period.teamHint);
      const hintNorm = normalizeTeamName(cleanedHint || period.teamHint);
      let teamId: number | null = null;
      if (hintNorm === normalizeTeamName(block.scoreLine.teamA)) teamId = homeTeam.id;
      else if (hintNorm === normalizeTeamName(block.scoreLine.teamB)) teamId = awayTeam.id;
      else if (hintNorm === normalizeTeamName(homeTeam.name)) teamId = homeTeam.id;
      else if (hintNorm === normalizeTeamName(awayTeam.name)) teamId = awayTeam.id;
      else {
        // Wave 13 Lane 1 (Chewy 🐻💪): same partial-match strategy as the
        // player-stat hint resolver — catches "PR" → "Pennridge",
        // "QT" → "Quakertown", "PJP II" → "Pope John Paul II", etc.
        const homeMatch =
          (cleanedHint && partialMatchesTeam(cleanedHint, homeTeam.name)) ||
          (cleanedHint && partialMatchesTeam(cleanedHint, block.scoreLine.teamA));
        const awayMatch =
          (cleanedHint && partialMatchesTeam(cleanedHint, awayTeam.name)) ||
          (cleanedHint && partialMatchesTeam(cleanedHint, block.scoreLine.teamB));
        if (homeMatch && !awayMatch) teamId = homeTeam.id;
        else if (awayMatch && !homeMatch) teamId = awayTeam.id;
        else {
          // Last-ditch: see if the hint matches an existing team via alias.
          // Use lookup-only (findTeamByName) to avoid creating ghost team rows
          // from stray abbreviation hints like "DV:" or "AC:".
          const t = findTeamByName(db, cleanedHint || period.teamHint);
          if (t) {
            if (t.id === homeTeam.id) teamId = homeTeam.id;
            else if (t.id === awayTeam.id) teamId = awayTeam.id;
          }
          // If still ambiguous (both partial-matched), default to home —
          // mirrors the player-stat hint resolver fallback.
          if (teamId === null && homeMatch && awayMatch) teamId = homeTeam.id;
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
 * Attribute player_stat lines to the home or away team.
 *
 * Wave 12 Lane 1 (Darth 😈⚡): replaces the prior parallel-walk strategy,
 * which re-iterated `block.rawLines` with a `looksLikePlayer` heuristic that
 * disagreed with `parsePlayerStatLine`, causing `psIdx` desync (148
 * NULL_HEADER anomalies). The parser now records the most recent sub-header
 * onto each player stat directly via `playerStatTeamHints`. Resolution:
 *
 *   1. Hint == null → home (the canonical default for "stats appearing
 *      before any sub-header was seen").
 *   2. Direct normalized match against home / away.
 *   3. Partial match (substring word-prefix or initials abbrev) against home
 *      or away display name. Examples:
 *         - "Haverford" ⊂ "Haverford School"            (game 0 home)
 *         - "WC Henderson" ⊃ "Henderson"                (game 12 home)
 *         - "PV"        = initials of "Perkiomen Valley" (game 23 home)
 *         - "DB"        = initials of "Daniel Boone"     (game 10 away)
 *      If exactly one of {home, away} matches, attribute to that team.
 *   4. Fall back to `findTeamByName`. If it returns a team that IS one of the
 *      two in this game, use it. If it returns a team OUTSIDE the game but a
 *      partial match (step 3) was ambiguous, prefer the partial match if it
 *      exists for one team and the fallback for the other.
 *   5. Else null = uncertain anomaly with the unresolved sub-header recorded.
 */
function assignAndUpsertPlayerStats(a: AssignArgs): void {
  const { db, block, gameId, homeTeam, awayTeam, input, counters,
    upsertPlayer, upsertPlayerStat } = a;

  const homeNorm = normalizeTeamName(block.scoreLine.teamA);
  const awayNorm = normalizeTeamName(block.scoreLine.teamB);
  const homeDisplayNorm = normalizeTeamName(homeTeam.name);
  const awayDisplayNorm = normalizeTeamName(awayTeam.name);

  function resolveHint(rawHint: string | null): {
    team: TeamRow | null;
    failToken: string | null;
  } {
    if (rawHint === null) return { team: homeTeam, failToken: null };
    const trimmed = rawHint.trim();
    const cleaned = normalizeTeamToken(trimmed);
    if (!cleaned) return { team: homeTeam, failToken: null };
    const norm = normalizeTeamName(cleaned);

    // (2) direct normalized match against either team (score-line-derived
    //     names AND DB display names — covers cases where the score line uses
    //     an alias but the DB has the canonical full name).
    if (norm === homeNorm || norm === homeDisplayNorm) {
      return { team: homeTeam, failToken: null };
    }
    if (norm === awayNorm || norm === awayDisplayNorm) {
      return { team: awayTeam, failToken: null };
    }

    // (3) partial match (substring word-prefix or initials).
    const homeMatch = partialMatchesTeam(cleaned, homeTeam.name)
      || partialMatchesTeam(cleaned, block.scoreLine.teamA);
    const awayMatch = partialMatchesTeam(cleaned, awayTeam.name)
      || partialMatchesTeam(cleaned, block.scoreLine.teamB);
    if (homeMatch && !awayMatch) return { team: homeTeam, failToken: null };
    if (awayMatch && !homeMatch) return { team: awayTeam, failToken: null };

    // (4) DB lookup — but ONLY accept the result if it's one of the two
    //     teams in the current game. Otherwise it's a foreign team match
    //     (e.g. "Haverford" → "Haverford High" when the home is
    //     "Haverford School"); treat as unresolved.
    const t = findTeamByName(db, cleaned);
    if (t) {
      if (t.id === homeTeam.id) return { team: homeTeam, failToken: null };
      if (t.id === awayTeam.id) return { team: awayTeam, failToken: null };
    }

    // If both home and away partial-matched (ambiguous), default to home —
    // the most common pattern is sub-headers appearing in home-then-away
    // order, and the home team is where unresolved stats historically went.
    if (homeMatch && awayMatch) return { team: homeTeam, failToken: null };

    return { team: null, failToken: trimmed };
  }

  const hints = block.playerStatTeamHints;
  const attributions: (TeamRow | null)[] = [];
  const attributionFailToken: (string | null)[] = [];
  for (let i = 0; i < block.playerStats.length; i++) {
    const hint = i < hints.length ? hints[i]! : null;
    const r = resolveHint(hint);
    attributions.push(r.team);
    attributionFailToken.push(r.failToken);
  }

  for (let i = 0; i < block.playerStats.length; i++) {
    const ps: ParsedPlayerStat = block.playerStats[i]!;
    const team = attributions[i];
    if (!team) {
      const failToken = attributionFailToken[i];
      const tokenSuffix = failToken ? ` [unresolved sub-header: "${failToken}"]` : '';
      counters.anomaliesAdded += insertAnomaly(db, {
        sourcePostId: input.postId,
        sourceUrl: input.postUrl,
        rawLine: `player stat dropped — uncertain team: ${ps.name} ${ps.goals}g ${ps.assists}a${tokenSuffix}`,
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
      a.input.season ?? DEFAULT_SEASON,
    );
    counters.playerStatsUpserted++;
  }
}

/**
 * Does the sub-header string `sub` plausibly refer to the team `teamName`,
 * even though their normalized forms differ? Three strategies:
 *
 *   (a) Word-prefix subset: every word of the shorter side is a prefix of the
 *       corresponding word of the longer side, when the shorter side is
 *       aligned at either the start or the end of the longer side.
 *       "Haverford" vs "Haverford School" → match (sub at start).
 *       "WC Henderson" vs "Henderson"     → match (team at end of sub).
 *       "Springfield" vs "Springfield-Delco" → match (after dash split).
 *   (b) Initials: a single 2-5 char alphabetic token whose chars equal the
 *       leading character of each word of the team name.
 *       "PV" vs "Perkiomen Valley", "NHS" vs "New Hope-Solebury",
 *       "DB" vs "Daniel Boone".
 *   (c) Concatenated initials with the first word spelled out:
 *       "UMoreland" vs "Upper Moreland" — handled by stripping a leading
 *       single capital letter and comparing the rest to the second word.
 */
export function partialMatchesTeam(sub: string, teamName: string): boolean {
  const subNorm = normalizeTeamName(sub);
  const teamNorm = normalizeTeamName(teamName);
  if (!subNorm || !teamNorm || subNorm === teamNorm) return subNorm === teamNorm;

  const splitWords = (s: string): string[] =>
    s.split(/[\s\-]+/).filter(w => w.length > 0);
  const subWords = splitWords(subNorm);
  const teamWords = splitWords(teamNorm);
  if (subWords.length === 0 || teamWords.length === 0) return false;

  // (a) word-prefix subset, aligned at start
  const wordsAligned = (short: string[], long: string[]): boolean => {
    if (short.length > long.length) return false;
    for (let i = 0; i < short.length; i++) {
      if (long[i] !== short[i] && !long[i]!.startsWith(short[i]!)) return false;
    }
    return true;
  };
  if (wordsAligned(subWords, teamWords)) return true;
  if (wordsAligned(teamWords, subWords)) return true;
  // aligned at end
  const wordsAlignedEnd = (short: string[], long: string[]): boolean => {
    if (short.length > long.length) return false;
    const off = long.length - short.length;
    for (let i = 0; i < short.length; i++) {
      if (long[off + i] !== short[i] && !long[off + i]!.startsWith(short[i]!)) return false;
    }
    return true;
  };
  if (wordsAlignedEnd(subWords, teamWords)) return true;
  if (wordsAlignedEnd(teamWords, subWords)) return true;

  // (b) initials
  if (subWords.length === 1 && /^[a-z]{2,5}$/.test(subWords[0]!) && teamWords.length >= 2) {
    const initials = teamWords.map(w => w[0] ?? '').join('');
    if (initials === subWords[0]) return true;
  }
  if (teamWords.length === 1 && /^[a-z]{2,5}$/.test(teamWords[0]!) && subWords.length >= 2) {
    const initials = subWords.map(w => w[0] ?? '').join('');
    if (initials === teamWords[0]) return true;
  }

  // (c) leading-initial + spelled-out form: "umoreland" vs "upper moreland"
  if (subWords.length === 1 && teamWords.length === 2) {
    const w = subWords[0]!;
    if (w.length >= 3 && w[0] === teamWords[0]![0] && w.slice(1) === teamWords[1]) return true;
  }
  if (teamWords.length === 1 && subWords.length === 2) {
    const w = teamWords[0]!;
    if (w.length >= 3 && w[0] === subWords[0]![0] && w.slice(1) === subWords[1]) return true;
  }

  return false;
}
