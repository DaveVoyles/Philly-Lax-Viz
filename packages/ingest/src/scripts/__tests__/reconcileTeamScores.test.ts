import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadMigrations, runMigrations } from '../../db.js';
import { countScannedGames, findSuspectRows } from '../reconcileTeamScores.js';

function freshDb(): DatabaseType {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  return db;
}

function seedTeam(db: DatabaseType, id: number, name: string, slug: string): void {
  db.prepare(
    `INSERT INTO teams (id, name, slug, division) VALUES (?, ?, ?, 'high-school')`,
  ).run(id, name, slug);
}

function seedGame(
  db: DatabaseType,
  args: {
    id: number;
    homeId: number;
    awayId: number;
    homeScore: number;
    awayScore: number;
    date?: string;
    recapUrl?: string | null;
    postponed?: number;
  },
): void {
  db.prepare(
    `INSERT INTO games
       (id, date, home_team_id, away_team_id, home_score, away_score,
        ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, '2026-04-10T00:00:00Z', 2026)`,
  ).run(
    args.id,
    args.date ?? '2026-04-16',
    args.homeId,
    args.awayId,
    args.homeScore,
    args.awayScore,
    args.postponed ?? 0,
    `post-${args.id}`,
    args.recapUrl ?? `https://example.test/recap/${args.id}`,
  );
}

function seedPlayer(db: DatabaseType, id: number, name: string, teamId: number): void {
  db.prepare(
    `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
     VALUES (?, ?, ?, ?, 'full')`,
  ).run(id, name, name.toLowerCase().trim(), teamId);
}

function seedStat(db: DatabaseType, gameId: number, playerId: number, goals: number): void {
  db.prepare(
    `INSERT INTO player_stats
       (game_id, player_id, goals, assists, ground_balls, caused_turnovers,
        saves, fo_won, fo_taken, source, parser_version, confidence, season)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 'summary', 'test-0.1.0', 1.0, 2026)`,
  ).run(gameId, playerId, goals);
}

describe('reconcileTeamScores', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = freshDb();
    seedTeam(db, 1, 'Haverford', 'haverford');
    seedTeam(db, 2, 'Pottsgrove', 'pottsgrove');
    seedTeam(db, 3, 'Episcopal', 'episcopal');
    seedTeam(db, 4, 'Malvern', 'malvern');
  });

  it('returns no suspects when player-goal sums match team scores', () => {
    // Legit game: Haverford 10 @ Episcopal 4, per-player sums agree.
    seedGame(db, { id: 10, homeId: 1, awayId: 3, homeScore: 10, awayScore: 4 });
    seedPlayer(db, 100, 'A Haverford', 1);
    seedPlayer(db, 101, 'B Haverford', 1);
    seedPlayer(db, 200, 'A Episcopal', 3);
    seedStat(db, 10, 100, 6);
    seedStat(db, 10, 101, 4);
    seedStat(db, 10, 200, 4);

    expect(findSuspectRows(db)).toEqual([]);
    expect(countScannedGames(db)).toBe(1);
  });

  it('flags the game-154-style case: per-player sum exceeds team score', () => {
    // Legit game, untouched.
    seedGame(db, { id: 10, homeId: 1, awayId: 3, homeScore: 5, awayScore: 5 });
    seedPlayer(db, 100, 'Haver Scorer', 1);
    seedPlayer(db, 200, 'Epis Scorer', 3);
    seedStat(db, 10, 100, 5);
    seedStat(db, 10, 200, 5);

    // Suspect game: Pottsgrove visits Malvern; team_score=0 but 3 players each scored.
    seedGame(db, { id: 154, homeId: 4, awayId: 2, homeScore: 15, awayScore: 0 });
    seedPlayer(db, 400, 'Raggazino', 2);
    seedPlayer(db, 401, 'Henzes', 2);
    seedPlayer(db, 402, 'Hires', 2);
    seedStat(db, 154, 400, 3);
    seedStat(db, 154, 401, 1);
    seedStat(db, 154, 402, 1);

    const suspects = findSuspectRows(db);
    expect(suspects).toHaveLength(1);
    const s = suspects[0]!;
    expect(s.gameId).toBe(154);
    expect(s.teamId).toBe(2);
    expect(s.teamName).toBe('Pottsgrove');
    expect(s.opponentName).toBe('Malvern');
    expect(s.currentScore).toBe(0);
    expect(s.playerGoalsSum).toBe(5);
    expect(s.suspectDelta).toBe(5);
    expect(s.sourcePostUrl).toBe('https://example.test/recap/154');
    expect(countScannedGames(db)).toBe(2);
  });

  it('ignores postponed games', () => {
    seedGame(db, {
      id: 50, homeId: 1, awayId: 2, homeScore: 0, awayScore: 0, postponed: 1,
    });
    seedPlayer(db, 100, 'Phantom', 1);
    seedStat(db, 50, 100, 4);

    expect(findSuspectRows(db)).toEqual([]);
    expect(countScannedGames(db)).toBe(0);
  });
});
