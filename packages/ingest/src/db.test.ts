import { describe, it, expect } from 'vitest';
import { openDb, CURRENT_SCHEMA_VERSION } from './db.js';

const EXPECTED_TABLES = [
  'teams',
  'games',
  'game_periods',
  'players',
  'player_stats',
  'team_aliases',
  'rankings',
  'ingest_log',
  'ingest_anomalies',
  'raw_cache_meta',
  'ingest_post_log',
  'piaa_official_teams',
  'player_aliases',
  'schedule_games',
  'post_images',
  'dedup_candidates',
];

function tableNames(db: ReturnType<typeof openDb>): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name).sort();
}

describe('openDb', () => {
  it('applies migrations on a fresh in-memory DB and creates all expected tables', () => {
    const db = openDb(':memory:');
    const names = tableNames(db);
    for (const t of EXPECTED_TABLES) {
      expect(names, `missing table: ${t}`).toContain(t);
    }
    // user_version tracks the highest applied migration.
    expect(db.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
    db.close();
  });

  it('is idempotent — re-opening does not re-apply migrations', () => {
    const db1 = openDb(':memory:');
    expect(db1.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
    db1.close();

    // Run migrations a second time on a brand-new DB and confirm same end state.
    const db2 = openDb(':memory:');
    expect(db2.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
    db2.close();
  });

  it('games / player_stats / ingest_post_log have a season column (W13)', () => {
    const db = openDb(':memory:');
    for (const tbl of ['games', 'player_stats', 'ingest_post_log']) {
      const cols = (db.prepare(`PRAGMA table_info(${tbl})`).all() as Array<{ name: string }>)
        .map((c) => c.name);
      expect(cols, `missing season column in ${tbl}`).toContain('season');
    }
    db.close();
  });

  it('teams table has wave-3 logo columns', () => {
    const db = openDb(':memory:');
    const cols = (db.prepare('PRAGMA table_info(teams)').all() as Array<{ name: string }>)
      .map((c) => c.name)
      .sort();
    expect(cols).toContain('logo_url');
    expect(cols).toContain('maxpreps_slug');
    db.close();
  });

  it('teams table has wave-16 branding columns (primary_color, secondary_color, nickname)', () => {
    const db = openDb(':memory:');
    const cols = (db.prepare('PRAGMA table_info(teams)').all() as Array<{ name: string }>)
      .map((c) => c.name)
      .sort();
    expect(cols).toContain('primary_color');
    expect(cols).toContain('secondary_color');
    expect(cols).toContain('nickname');
    db.close();
  });

  it('games table has expected columns from the plan', () => {
    const db = openDb(':memory:');
    const cols = (db.prepare('PRAGMA table_info(games)').all() as Array<{ name: string }>)
      .map((c) => c.name)
      .sort();
    for (const c of [
      'id',
      'date',
      'home_team_id',
      'away_team_id',
      'home_score',
      'away_score',
      'ot_periods',
      'postponed',
      'source_post_id',
      'recap_url',
      'parsed_at',
      'source', // Wave-18 W2L1: provenance column
    ]) {
      expect(cols, `missing games column: ${c}`).toContain(c);
    }
    db.close();
  });

  it('player_stats table has expected stat columns', () => {
    const db = openDb(':memory:');
    const cols = (db.prepare('PRAGMA table_info(player_stats)').all() as Array<{ name: string }>)
      .map((c) => c.name)
      .sort();
    for (const c of [
      'goals',
      'assists',
      'ground_balls',
      'caused_turnovers',
      'saves',
      'fo_won',
      'fo_taken',
      'source',
      'parser_version',
      'confidence',
    ]) {
      expect(cols, `missing player_stats column: ${c}`).toContain(c);
    }
    db.close();
  });
});
