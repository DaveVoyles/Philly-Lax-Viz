import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../../db.js';
import {
  runChecks,
  collectAllFindings,
  applyAnomalies,
  SEASON,
} from '../auditCrossChecks.js';

function freshDb(): DatabaseType {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  return db;
}

interface TeamSeed { id: number; name: string; slug: string }

function seedTeam(db: DatabaseType, t: TeamSeed): void {
  db.prepare(
    `INSERT INTO teams (id, name, slug, division) VALUES (?, ?, ?, 'high-school')`,
  ).run(t.id, t.name, t.slug);
}

interface GameSeed {
  id: number;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
  date?: string;
  postId?: string;
  recapUrl?: string | null;
  season?: number;
  postponed?: number;
}

function seedGame(db: DatabaseType, g: GameSeed): void {
  db.prepare(
    `INSERT INTO games
       (id, date, home_team_id, away_team_id, home_score, away_score,
        ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
  ).run(
    g.id,
    g.date ?? '2026-04-10',
    g.homeTeamId,
    g.awayTeamId,
    g.homeScore,
    g.awayScore,
    g.postponed ?? 0,
    g.postId ?? `post-${g.id}`,
    g.recapUrl ?? `https://example.test/recap/${g.id}`,
    '2026-04-10T00:00:00Z',
    g.season ?? SEASON,
  );
}

interface PlayerSeed { id: number; name: string; teamId: number }

function seedPlayer(db: DatabaseType, p: PlayerSeed): void {
  db.prepare(
    `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
     VALUES (?, ?, ?, ?, 'full')`,
  ).run(p.id, p.name, p.name.toLowerCase(), p.teamId);
}

interface StatSeed {
  gameId: number;
  playerId: number;
  goals?: number;
  assists?: number;
  saves?: number;
  season?: number;
}

function seedStat(db: DatabaseType, s: StatSeed): void {
  db.prepare(
    `INSERT INTO player_stats
       (game_id, player_id, goals, assists, ground_balls, caused_turnovers,
        saves, fo_won, fo_taken, source, parser_version, confidence, season)
     VALUES (?, ?, ?, ?, 0, 0, ?, 0, 0, 'summary', '0.2.7', 1.0, ?)`,
  ).run(
    s.gameId,
    s.playerId,
    s.goals ?? 0,
    s.assists ?? 0,
    s.saves ?? 0,
    s.season ?? SEASON,
  );
}

describe('auditCrossChecks', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = freshDb();
    seedTeam(db, { id: 1, name: 'Bonner-Prendergast', slug: 'bonner-prendie' });
    seedTeam(db, { id: 2, name: 'Haverford School', slug: 'haverford-school' });
  });

  describe('cross-check-player-exceeds-team', () => {
    it('flags a player whose goals exceed their team score, ignores normal cases', () => {
      seedGame(db, { id: 100, homeTeamId: 1, awayTeamId: 2, homeScore: 0, awayScore: 15 });
      seedPlayer(db, { id: 10, name: 'Wrong Player', teamId: 1 });
      seedPlayer(db, { id: 11, name: 'Real Scorer', teamId: 2 });
      seedStat(db, { gameId: 100, playerId: 10, goals: 3 });
      seedStat(db, { gameId: 100, playerId: 11, goals: 5 });

      const r = runChecks(db).find((x) => x.check === 'cross-check-player-exceeds-team')!;
      expect(r.count).toBe(1);
      expect(r.samples[0]!.playerId).toBe(10);
      expect(r.samples[0]!.parentGameId).toBe(100);
      expect(r.samples[0]!.reason).toMatch(/3 goals/);
    });

    it('respects season filter and ignores postponed games', () => {
      seedGame(db, {
        id: 200, homeTeamId: 1, awayTeamId: 2, homeScore: 0, awayScore: 10, season: 2025,
      });
      seedGame(db, {
        id: 201, homeTeamId: 1, awayTeamId: 2, homeScore: 0, awayScore: 10, postponed: 1,
        date: '2026-04-11',
      });
      seedPlayer(db, { id: 20, name: 'Old Season', teamId: 1 });
      seedStat(db, { gameId: 200, playerId: 20, goals: 5, season: 2025 });
      seedStat(db, { gameId: 201, playerId: 20, goals: 5 });

      const r = runChecks(db).find((x) => x.check === 'cross-check-player-exceeds-team')!;
      expect(r.count).toBe(0);
    });
  });

  describe('cross-check-sum-exceeds-team', () => {
    it('flags a team side whose summed goals exceed score+slack', () => {
      seedGame(db, { id: 300, homeTeamId: 1, awayTeamId: 2, homeScore: 5, awayScore: 8 });
      seedPlayer(db, { id: 30, name: 'A One', teamId: 1 });
      seedPlayer(db, { id: 31, name: 'A Two', teamId: 1 });
      seedPlayer(db, { id: 32, name: 'B One', teamId: 2 });
      seedStat(db, { gameId: 300, playerId: 30, goals: 4 });
      seedStat(db, { gameId: 300, playerId: 31, goals: 5 });
      seedStat(db, { gameId: 300, playerId: 32, goals: 7 });

      const r = runChecks(db).find((x) => x.check === 'cross-check-sum-exceeds-team')!;
      expect(r.count).toBe(1);
      expect(r.samples[0]!.parentGameId).toBe(300);
      expect(r.samples[0]!.rawLine).toContain('team_id=1');
    });

    it('does not flag when sum is within slack', () => {
      seedGame(db, { id: 301, homeTeamId: 1, awayTeamId: 2, homeScore: 10, awayScore: 0 });
      seedPlayer(db, { id: 40, name: 'Home Player', teamId: 1 });
      seedStat(db, { gameId: 301, playerId: 40, goals: 12 });

      const r = runChecks(db).find((x) => x.check === 'cross-check-sum-exceeds-team')!;
      expect(r.count).toBe(0);
    });
  });

  describe('cross-check-suspect-name', () => {
    it('flags single-token short names and stat-word names with stats', () => {
      seedGame(db, { id: 400, homeTeamId: 1, awayTeamId: 2, homeScore: 5, awayScore: 5 });
      seedPlayer(db, { id: 50, name: 'Fry', teamId: 1 });
      seedPlayer(db, { id: 51, name: 'Goals', teamId: 1 });
      seedPlayer(db, { id: 52, name: 'Connor McSweeney', teamId: 2 });
      seedPlayer(db, { id: 53, name: 'Smith', teamId: 2 });
      seedStat(db, { gameId: 400, playerId: 50, goals: 1 });
      seedStat(db, { gameId: 400, playerId: 51, goals: 1 });
      seedStat(db, { gameId: 400, playerId: 52, goals: 2 });
      seedStat(db, { gameId: 400, playerId: 53, goals: 1 });

      const r = runChecks(db).find((x) => x.check === 'cross-check-suspect-name')!;
      const ids = r.samples.map((s) => s.playerId).sort((a, b) => (a! - b!));
      expect(r.count).toBe(2);
      expect(ids).toEqual([50, 51]);
    });

    it('does not flag suspect-named players with no stats', () => {
      seedPlayer(db, { id: 60, name: 'Ray', teamId: 1 });
      const r = runChecks(db).find((x) => x.check === 'cross-check-suspect-name')!;
      expect(r.count).toBe(0);
    });
  });

  describe('cross-check-goalie-as-scorer', () => {
    it('flags players whose name contains "goalie" but who recorded goals or assists', () => {
      seedGame(db, { id: 500, homeTeamId: 1, awayTeamId: 2, homeScore: 5, awayScore: 5 });
      seedPlayer(db, { id: 70, name: 'Smith Goalie', teamId: 1 });
      seedPlayer(db, { id: 71, name: 'Real Goalie', teamId: 2 });
      seedStat(db, { gameId: 500, playerId: 70, goals: 2 });
      seedStat(db, { gameId: 500, playerId: 71, goals: 0, saves: 12 });

      const r = runChecks(db).find((x) => x.check === 'cross-check-goalie-as-scorer')!;
      expect(r.count).toBe(1);
      expect(r.samples[0]!.playerId).toBe(70);
    });
  });

  describe('cross-check-season-concentration', () => {
    it('flags players where one game accounts for >60% of season goals (>=10)', () => {
      seedGame(db, { id: 600, homeTeamId: 1, awayTeamId: 2, homeScore: 8, awayScore: 5 });
      seedGame(db, {
        id: 601, homeTeamId: 2, awayTeamId: 1, homeScore: 5, awayScore: 5,
        date: '2026-04-12',
      });
      seedPlayer(db, { id: 80, name: 'Spike Player', teamId: 1 });
      seedPlayer(db, { id: 81, name: 'Steady Player', teamId: 1 });
      seedStat(db, { gameId: 600, playerId: 80, goals: 8 });
      seedStat(db, { gameId: 601, playerId: 80, goals: 2 });
      seedStat(db, { gameId: 600, playerId: 81, goals: 5 });
      seedStat(db, { gameId: 601, playerId: 81, goals: 5 });

      const r = runChecks(db).find((x) => x.check === 'cross-check-season-concentration')!;
      expect(r.count).toBe(1);
      expect(r.samples[0]!.playerId).toBe(80);
    });

    it('does not flag players below the 10-goal season floor', () => {
      seedGame(db, { id: 700, homeTeamId: 1, awayTeamId: 2, homeScore: 9, awayScore: 0 });
      seedPlayer(db, { id: 90, name: 'Low Volume', teamId: 1 });
      seedStat(db, { gameId: 700, playerId: 90, goals: 9 });
      const r = runChecks(db).find((x) => x.check === 'cross-check-season-concentration')!;
      expect(r.count).toBe(0);
    });
  });

  describe('applyAnomalies idempotency', () => {
    it('does not duplicate anomaly rows on re-run', () => {
      seedGame(db, { id: 800, homeTeamId: 1, awayTeamId: 2, homeScore: 0, awayScore: 10 });
      seedPlayer(db, { id: 100, name: 'Wrong Side', teamId: 1 });
      seedStat(db, { gameId: 800, playerId: 100, goals: 4 });

      const findings = collectAllFindings(db);
      const reports = runChecks(db);
      const firstInsert = applyAnomalies(db, reports, findings);
      expect(firstInsert['cross-check-player-exceeds-team']).toBe(1);

      const secondInsert = applyAnomalies(db, reports, findings);
      expect(secondInsert['cross-check-player-exceeds-team']).toBe(0);

      const total = db
        .prepare(
          `SELECT COUNT(*) AS n FROM ingest_anomalies
            WHERE strategy_attempted = 'cross-check-player-exceeds-team'`,
        )
        .get() as { n: number };
      expect(total.n).toBe(1);
    });
  });
});
