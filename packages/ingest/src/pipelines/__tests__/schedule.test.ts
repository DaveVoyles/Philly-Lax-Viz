import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../db.js';
import { ingestScheduleRows } from '../schedule.js';
import type { ScheduleCsvRow } from '../../parsers/scheduleCsv.js';

function seed(db: Database): void {
  db.prepare("INSERT INTO teams (id, name, slug, division) VALUES (1, 'Haverford', 'haverford', 'high-school')").run();
  db.prepare("INSERT INTO teams (id, name, slug, division) VALUES (2, 'Episcopal Academy', 'episcopal-academy', 'high-school')").run();
  db.prepare("INSERT INTO teams (id, name, slug, division) VALUES (3, 'Cheltenham', 'cheltenham', 'high-school')").run();
  // alias so PIAA's ALL-CAPS "UPPER DARBY" resolves but the test row will
  // also exercise the unresolved path for an unknown opponent.
  db.prepare("INSERT INTO teams (id, name, slug, division) VALUES (4, 'Upper Darby', 'upper-darby', 'high-school')").run();
}

const ROWS = (): ScheduleCsvRow[] => [
  { date: '2026-05-11', homeTeamRaw: 'CHELTENHAM', awayTeamRaw: 'UPPER DARBY', completed: false, homeScore: null, awayScore: null },
  { date: '2026-05-13', homeTeamRaw: 'Haverford', awayTeamRaw: 'Episcopal Academy', completed: false, homeScore: null, awayScore: null },
  { date: '2026-05-15', homeTeamRaw: 'Haverford', awayTeamRaw: 'Some Random Out-of-State School', completed: false, homeScore: null, awayScore: null },
  { date: '2026-04-01', homeTeamRaw: 'Haverford', awayTeamRaw: 'Cheltenham', completed: true, homeScore: 8, awayScore: 5 },
];

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
});

describe('ingestScheduleRows', () => {
  it('upserts upcoming rows, skips completed, and resolves known teams', () => {
    const r = ingestScheduleRows(db, {
      source: 'piaa-d1',
      sourceUrl: 'https://example/sched.csv',
      season: 2026,
      rows: ROWS(),
    });
    expect(r.scheduleRowsUpserted).toBe(3);
    expect(r.scheduleRowsSkippedCompleted).toBe(1);

    const inDb = db.prepare('SELECT COUNT(*) AS n FROM schedule_games').get() as { n: number };
    expect(inDb.n).toBe(3);

    const cheltenham = db
      .prepare(`SELECT home_team_id, away_team_id, home_team_name_raw, away_team_name_raw FROM schedule_games WHERE game_date = '2026-05-11'`)
      .get() as { home_team_id: number; away_team_id: number; home_team_name_raw: string; away_team_name_raw: string };
    expect(cheltenham.home_team_id).toBe(3);
    expect(cheltenham.away_team_id).toBe(4);
    expect(cheltenham.home_team_name_raw).toBe('CHELTENHAM');
  });

  it('records null team_id and emits an anomaly when a team cannot be resolved', () => {
    const r = ingestScheduleRows(db, {
      source: 'piaa-d1',
      sourceUrl: 'https://example/sched.csv',
      season: 2026,
      rows: ROWS(),
    });
    expect(r.awayUnresolved).toBeGreaterThanOrEqual(1);
    expect(r.anomaliesAdded).toBeGreaterThanOrEqual(1);

    const unresolved = db
      .prepare(`SELECT home_team_id, away_team_id FROM schedule_games WHERE game_date = '2026-05-15'`)
      .get() as { home_team_id: number | null; away_team_id: number | null };
    expect(unresolved.home_team_id).toBe(1);
    expect(unresolved.away_team_id).toBeNull();

    const anomaly = db
      .prepare(`SELECT reason, raw_line FROM ingest_anomalies WHERE strategy_attempted = 'schedule-team-resolve'`)
      .get() as { reason: string; raw_line: string } | undefined;
    expect(anomaly).toBeDefined();
    expect(anomaly!.raw_line).toContain('Some Random');
  });

  it('is idempotent — running twice does not duplicate rows', () => {
    const rows = ROWS();
    ingestScheduleRows(db, { source: 'piaa-d1', sourceUrl: 'https://example/sched.csv', season: 2026, rows });
    ingestScheduleRows(db, { source: 'piaa-d1', sourceUrl: 'https://example/sched.csv', season: 2026, rows });
    const inDb = db.prepare('SELECT COUNT(*) AS n FROM schedule_games').get() as { n: number };
    expect(inDb.n).toBe(3);
  });
});
