import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadMigrations, runMigrations } from '../../db.js';
import { computeTotalsForTeam, findTotalsMismatches } from '../piaaCheckTotals.js';

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
    null,
  );
}

function seedPiaa(
  db: DatabaseType,
  args: {
    nameOfficial: string;
    nameNormalized: string;
    classification?: string;
    wins: number;
    losses: number;
    ties?: number;
    totalPoints: number;
    ranking?: number;
  },
): void {
  db.prepare(
    `INSERT INTO piaa_official_teams
       (name_official, name_normalized, classification, seed,
        wins, losses, ties, total_points, ranking, fetched_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, '2026-04-24T00:00:00Z')`,
  ).run(
    args.nameOfficial,
    args.nameNormalized,
    args.classification ?? '3A',
    args.wins,
    args.losses,
    args.ties ?? 0,
    args.totalPoints,
    args.ranking ?? 100,
  );
}

describe('piaaCheckTotals', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = freshDb();
  });

  it('flags a team whose computed wins and goals diverge from PIAA', () => {
    // Ridley plays 3 games: wins 12-5 (home), wins 8-4 (home), loses 5-9 (away).
    // Computed: 2W-1L, 25 GS. PIAA claims 3W-1L and 30 total points.
    seedTeam(db, 19, 'Ridley', 'ridley');
    seedTeam(db, 20, 'Garnet Valley', 'garnet-valley');
    seedTeam(db, 21, 'Penncrest', 'penncrest');
    seedTeam(db, 22, 'Strath Haven', 'strath-haven');

    seedGame(db, { id: 1, homeId: 19, awayId: 20, homeScore: 12, awayScore: 5 });
    seedGame(db, { id: 2, homeId: 19, awayId: 21, homeScore: 8, awayScore: 4 });
    seedGame(db, { id: 3, homeId: 22, awayId: 19, homeScore: 9, awayScore: 5 });

    seedPiaa(db, {
      nameOfficial: 'Ridley',
      nameNormalized: 'ridley',
      wins: 3,
      losses: 1,
      totalPoints: 30,
    });

    const computed = computeTotalsForTeam(db, 19);
    expect(computed).toEqual({ wins: 2, losses: 1, ties: 0, goalsScored: 25 });

    const rows = findTotalsMismatches(db);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.teamId).toBe(19);
    expect(r.teamName).toBe('Ridley');
    expect(r.piaaWins).toBe(3);
    expect(r.piaaLosses).toBe(1);
    expect(r.piaaTotalPoints).toBe(30);
    expect(r.computedWins).toBe(2);
    expect(r.computedLosses).toBe(1);
    expect(r.computedGoalsScored).toBe(25);
    expect(r.deltaWins).toBe(-1);
    expect(r.deltaLosses).toBe(0);
    expect(r.deltaPoints).toBe(-5);
  });

  it('excludes teams with no PIAA row', () => {
    seedTeam(db, 50, 'Unranked HS', 'unranked-hs');
    seedTeam(db, 51, 'Some Opponent', 'some-opponent');
    // Plenty of mismatch potential — but no PIAA row, so must not appear.
    seedGame(db, { id: 10, homeId: 50, awayId: 51, homeScore: 1, awayScore: 99 });

    expect(findTotalsMismatches(db)).toEqual([]);
  });

  it('omits teams that match PIAA exactly (zero deltas)', () => {
    seedTeam(db, 30, 'Haverford', 'haverford');
    seedTeam(db, 31, 'Episcopal', 'episcopal');
    // 1W, 1L, 18 goals scored.
    seedGame(db, { id: 20, homeId: 30, awayId: 31, homeScore: 10, awayScore: 4 });
    seedGame(db, { id: 21, homeId: 31, awayId: 30, homeScore: 12, awayScore: 8 });
    seedPiaa(db, {
      nameOfficial: 'Haverford',
      nameNormalized: 'haverford',
      wins: 1,
      losses: 1,
      totalPoints: 18,
    });

    expect(findTotalsMismatches(db)).toEqual([]);
  });

  it('counts ties correctly and ignores postponed games', () => {
    seedTeam(db, 40, 'Tied Town', 'tied-town');
    seedTeam(db, 41, 'Visitor A', 'visitor-a');
    seedTeam(db, 42, 'Visitor B', 'visitor-b');
    // 1 win (8-3), 1 tie (7-7), 1 postponed (must be ignored).
    seedGame(db, { id: 30, homeId: 40, awayId: 41, homeScore: 8, awayScore: 3 });
    seedGame(db, { id: 31, homeId: 40, awayId: 42, homeScore: 7, awayScore: 7 });
    seedGame(db, {
      id: 32, homeId: 40, awayId: 41, homeScore: 99, awayScore: 0,
      date: '2026-04-20', postponed: 1,
    });

    const computed = computeTotalsForTeam(db, 40);
    expect(computed).toEqual({ wins: 1, losses: 0, ties: 1, goalsScored: 15 });

    // PIAA agrees on W/L/points → no row emitted even with a tie present.
    seedPiaa(db, {
      nameOfficial: 'Tied Town',
      nameNormalized: 'tied town',
      wins: 1,
      losses: 0,
      ties: 1,
      totalPoints: 15,
    });
    db.prepare(`INSERT INTO team_aliases (alias, team_id, source) VALUES (?, ?, 'manual')`)
      .run('tied town', 40);

    expect(findTotalsMismatches(db)).toEqual([]);
  });

  it('sorts by |ΔW|+|ΔL| desc, then |Δpts| desc', () => {
    seedTeam(db, 60, 'Big Record Gap', 'big-record-gap');
    seedTeam(db, 61, 'Big Point Gap', 'big-point-gap');
    seedTeam(db, 62, 'Filler Opp', 'filler-opp');

    // Team 60: 0 games played, PIAA says 5W-2L (record gap = 7).
    seedPiaa(db, {
      nameOfficial: 'Big Record Gap', nameNormalized: 'big record gap',
      wins: 5, losses: 2, totalPoints: 0,
    });
    db.prepare(`INSERT INTO team_aliases (alias, team_id, source) VALUES (?, ?, 'manual')`)
      .run('big record gap', 60);

    // Team 61: 1W, computed 10 GS, PIAA says 1W and 100 total_points (point gap huge,
    // record gap = 0).
    seedGame(db, { id: 70, homeId: 61, awayId: 62, homeScore: 10, awayScore: 0 });
    seedPiaa(db, {
      nameOfficial: 'Big Point Gap', nameNormalized: 'big point gap',
      wins: 1, losses: 0, totalPoints: 100,
    });
    db.prepare(`INSERT INTO team_aliases (alias, team_id, source) VALUES (?, ?, 'manual')`)
      .run('big point gap', 61);

    const rows = findTotalsMismatches(db);
    expect(rows.map((r) => r.teamId)).toEqual([60, 61]);
  });
});
