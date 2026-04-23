import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../../db.js';
import {
  findShortNamePlayers,
  buildReport,
  DEFAULT_MAX_LEN,
} from '../auditShortNames.js';

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

function seedPlayer(db: DatabaseType, id: number, name: string, teamId: number): void {
  db.prepare(
    `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
     VALUES (?, ?, ?, ?, 'full')`,
  ).run(id, name, name.toLowerCase(), teamId);
}

function seedGame(
  db: DatabaseType,
  id: number,
  homeTeamId: number,
  awayTeamId: number,
  date = '2026-04-10',
  recapUrl: string | null = `https://example.test/recap/${id}`,
): void {
  db.prepare(
    `INSERT INTO games
       (id, date, home_team_id, away_team_id, home_score, away_score,
        ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (?, ?, ?, ?, 5, 5, 0, 0, ?, ?, ?, 2026)`,
  ).run(id, date, homeTeamId, awayTeamId, `post-${id}`, recapUrl, '2026-04-10T00:00:00Z');
}

function seedStat(
  db: DatabaseType,
  gameId: number,
  playerId: number,
  goals = 0,
  assists = 0,
): void {
  db.prepare(
    `INSERT INTO player_stats
       (game_id, player_id, goals, assists, ground_balls, caused_turnovers,
        saves, fo_won, fo_taken, source, parser_version, confidence, season)
     VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 'summary', '0.2.7', 1.0, 2026)`,
  ).run(gameId, playerId, goals, assists);
}

describe('auditShortNames', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = freshDb();
    seedTeam(db, 1, 'Bonner-Prendergast', 'bonner-prendie');
    seedTeam(db, 2, 'Haverford School', 'haverford-school');
  });

  it('flags only short single-token names, ignores normal multi-word names', () => {
    seedPlayer(db, 10, 'Doll', 1);
    seedPlayer(db, 11, 'Pierce Merrill', 2);
    seedGame(db, 100, 1, 2);
    seedStat(db, 100, 10, 2, 1);
    seedStat(db, 100, 11, 3, 2);

    const rows = findShortNamePlayers(db, DEFAULT_MAX_LEN);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(10);
    expect(rows[0]!.name).toBe('Doll');
    expect(rows[0]!.team).toBe('Bonner-Prendergast');
    expect(rows[0]!.games).toBe(1);
    expect(rows[0]!.goals).toBe(2);
    expect(rows[0]!.assists).toBe(1);
    expect(rows[0]!.sample_recap).toBe('https://example.test/recap/100');
  });

  it('honors --max-len: max-len 3 excludes a 4-char player', () => {
    seedPlayer(db, 20, 'Doll', 1); // 4 chars
    seedPlayer(db, 21, 'Fry', 1);  // 3 chars

    const rowsDefault = findShortNamePlayers(db, 4);
    expect(rowsDefault.map((r) => r.id).sort()).toEqual([20, 21]);

    const rowsTight = findShortNamePlayers(db, 3);
    expect(rowsTight).toHaveLength(1);
    expect(rowsTight[0]!.id).toBe(21);
    expect(rowsTight[0]!.name).toBe('Fry');
  });

  it('handles a player with no stats: game_count=0, sample_recap=null', () => {
    seedPlayer(db, 30, 'Ray', 1);

    const rows = findShortNamePlayers(db, DEFAULT_MAX_LEN);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.games).toBe(0);
    expect(rows[0]!.goals).toBe(0);
    expect(rows[0]!.assists).toBe(0);
    expect(rows[0]!.sample_recap).toBeNull();
  });

  it('picks the most recent game (by date) for sample_recap', () => {
    seedPlayer(db, 40, 'Cobb', 1);
    seedGame(db, 200, 1, 2, '2026-04-01', 'https://example.test/old');
    seedGame(db, 201, 1, 2, '2026-04-20', 'https://example.test/new');
    seedStat(db, 200, 40, 1);
    seedStat(db, 201, 40, 2);

    const rows = findShortNamePlayers(db, DEFAULT_MAX_LEN);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.games).toBe(2);
    expect(rows[0]!.goals).toBe(3);
    expect(rows[0]!.sample_recap).toBe('https://example.test/new');
  });

  it('sorts by games DESC, then name ASC', () => {
    seedPlayer(db, 50, 'Zorn', 1);
    seedPlayer(db, 51, 'Ash', 1);
    seedPlayer(db, 52, 'Ben', 1);
    seedGame(db, 300, 1, 2);
    seedStat(db, 300, 50, 1);

    const rows = findShortNamePlayers(db, DEFAULT_MAX_LEN);
    expect(rows.map((r) => r.name)).toEqual(['Zorn', 'Ash', 'Ben']);
  });

  it('buildReport adds triage_decision: null placeholder', () => {
    seedPlayer(db, 60, 'Doll', 1);
    const rows = findShortNamePlayers(db, DEFAULT_MAX_LEN);
    const report = buildReport(rows);
    expect(report).toHaveLength(1);
    expect(report[0]!.triage_decision).toBeNull();
    expect(report[0]!.name).toBe('Doll');
  });
});
