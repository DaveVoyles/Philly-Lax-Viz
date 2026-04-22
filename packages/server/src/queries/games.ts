// Per-game scoring-timeline helpers (Wave 14 Lane 3, Leia).
//
// We do not have per-goal timestamps in the source data — PhillyLacrosse
// recaps only give us:
//   1. Quarter-by-quarter team totals (`game_periods.goals` per team/period).
//   2. Per-player season totals for the game (`player_stats.goals`).
//
// To drive the scrubber timeline we synthesize a sequence of "scoring events"
// from those two sources. The contract is intentionally honest about being
// derived: every event carries a `synthesized: true` flag and the view
// renders a disclaimer.
//
// HEURISTIC (documented for downstream consumers):
//   - For each quarter Q and team T, the count of events emitted equals
//     `game_periods.goals` for (Q, T). Order across the game is Q1→Q4 then
//     interleaved between teams within the quarter (away first, then home,
//     repeating) so the running score stays close to monotonic.
//   - Each event is attributed to a player on the scoring team. Players are
//     chosen round-robin weighted by their season-game `goals`: a player
//     with N goals on the game is drawn at most N times across all four
//     quarters. If team scored more goals in `game_periods` than the sum
//     of their players' goal column (parser missed a stat line), the
//     excess events are emitted with `playerId: null`.
//   - Assists are attached opportunistically: when a teammate has a
//     remaining assist count, we credit one assist per event to the
//     teammate with the most remaining assists. This is a coarse heuristic
//     but matches the recap convention (assists usually pair with goals).
//
// This module is dependency-free (no DB) so it's trivial to unit-test.

import type { GamePeriod, PlayerStat } from '@pll/shared';

export interface ScoringEvent {
  /** 1-indexed quarter number (5+ = OT). */
  quarter: number;
  /** Sequence index across the whole game, 0-based. */
  sequence: number;
  /** Scoring team id. */
  teamId: number;
  /** Convenience side label relative to the game record. */
  side: 'home' | 'away';
  /** Attributed scorer; null when team-period total > sum(player goals). */
  playerId: number | null;
  playerName: string | null;
  /** Attributed primary assist (best-effort). */
  assistPlayerId: number | null;
  assistPlayerName: string | null;
  /** Running totals AFTER this event lands. */
  homeScoreAfter: number;
  awayScoreAfter: number;
  /** Always true for now — we have no real timestamps. */
  synthesized: true;
}

interface PlayerGameLine {
  playerId: number;
  playerName: string;
  teamId: number;
  goalsRemaining: number;
  assistsRemaining: number;
}

/**
 * Build the synthesized scoring-event list for one game.
 *
 * Inputs are already filtered to one game; this function does no I/O.
 */
export function synthesizeScoringEvents(
  periods: GamePeriod[],
  players: Array<PlayerStat & { playerName: string; teamName?: string }>,
  homeTeamId: number,
  awayTeamId: number,
): ScoringEvent[] {
  // Bucket period goals per team.
  // Map<teamId, Map<quarter, goals>>
  const teamPeriodGoals = new Map<number, Map<number, number>>();
  let maxQuarter = 4;
  for (const p of periods) {
    let row = teamPeriodGoals.get(p.teamId);
    if (!row) {
      row = new Map();
      teamPeriodGoals.set(p.teamId, row);
    }
    row.set(p.periodNumber, p.goals);
    if (p.periodNumber > maxQuarter) maxQuarter = p.periodNumber;
  }

  // Build mutable per-team scorer/assister pools.
  const poolsByTeam = new Map<number, PlayerGameLine[]>();
  for (const ps of players) {
    if (ps.goals === 0 && ps.assists === 0) continue;
    // playerStats rows have playerName joined onto them at the route layer.
    // We need teamId for grouping; the `PlayerStat` type doesn't carry teamId
    // directly so we look it up via the home/away team match elsewhere — but
    // here `players` was already filtered to this game, so every row's player
    // belongs to either the home or away team. The route hands us teamId via
    // the joined teamName→id map; for purity we accept it as a hint on the
    // PlayerStat row by augmenting the type below in the route layer.
    const teamId = (ps as PlayerStat & { teamId?: number }).teamId;
    if (teamId !== homeTeamId && teamId !== awayTeamId) continue;
    let pool = poolsByTeam.get(teamId);
    if (!pool) {
      pool = [];
      poolsByTeam.set(teamId, pool);
    }
    pool.push({
      playerId: ps.playerId,
      playerName: ps.playerName,
      teamId,
      goalsRemaining: ps.goals,
      assistsRemaining: ps.assists,
    });
  }

  // Sort scorer pools by descending goals so big scorers are picked first.
  for (const pool of poolsByTeam.values()) {
    pool.sort((a, b) => b.goalsRemaining - a.goalsRemaining);
  }

  function pickScorer(teamId: number): PlayerGameLine | null {
    const pool = poolsByTeam.get(teamId);
    if (!pool) return null;
    // Pick the player with the most goals still to attribute.
    let best: PlayerGameLine | null = null;
    for (const p of pool) {
      if (p.goalsRemaining <= 0) continue;
      if (!best || p.goalsRemaining > best.goalsRemaining) best = p;
    }
    return best;
  }

  function pickAssister(teamId: number, scorerId: number | null): PlayerGameLine | null {
    const pool = poolsByTeam.get(teamId);
    if (!pool) return null;
    let best: PlayerGameLine | null = null;
    for (const p of pool) {
      if (p.assistsRemaining <= 0) continue;
      if (p.playerId === scorerId) continue;
      if (!best || p.assistsRemaining > best.assistsRemaining) best = p;
    }
    return best;
  }

  const events: ScoringEvent[] = [];
  let homeScore = 0;
  let awayScore = 0;
  let seq = 0;

  for (let q = 1; q <= maxQuarter; q += 1) {
    const homeQ = teamPeriodGoals.get(homeTeamId)?.get(q) ?? 0;
    const awayQ = teamPeriodGoals.get(awayTeamId)?.get(q) ?? 0;
    let homeLeft = homeQ;
    let awayLeft = awayQ;

    // Interleave away→home so a 3-2 quarter renders A,H,A,H,A.
    while (homeLeft > 0 || awayLeft > 0) {
      if (awayLeft > 0) {
        const ev = buildEvent(q, awayTeamId, 'away');
        awayScore += 1;
        ev.homeScoreAfter = homeScore;
        ev.awayScoreAfter = awayScore;
        ev.sequence = seq;
        seq += 1;
        events.push(ev);
        awayLeft -= 1;
      }
      if (homeLeft > 0) {
        const ev = buildEvent(q, homeTeamId, 'home');
        homeScore += 1;
        ev.homeScoreAfter = homeScore;
        ev.awayScoreAfter = awayScore;
        ev.sequence = seq;
        seq += 1;
        events.push(ev);
        homeLeft -= 1;
      }
    }
  }

  return events;

  function buildEvent(quarter: number, teamId: number, side: 'home' | 'away'): ScoringEvent {
    const scorer = pickScorer(teamId);
    if (scorer) scorer.goalsRemaining -= 1;
    const assister = pickAssister(teamId, scorer?.playerId ?? null);
    if (assister) assister.assistsRemaining -= 1;
    return {
      quarter,
      sequence: 0,
      teamId,
      side,
      playerId: scorer?.playerId ?? null,
      playerName: scorer?.playerName ?? null,
      assistPlayerId: assister?.playerId ?? null,
      assistPlayerName: assister?.playerName ?? null,
      homeScoreAfter: 0,
      awayScoreAfter: 0,
      synthesized: true,
    };
  }
}
