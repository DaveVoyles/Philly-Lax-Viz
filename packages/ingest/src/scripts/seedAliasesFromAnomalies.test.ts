import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { loadMigrations, runMigrations } from '../db.js';
import {
  extractRawValueFromIngestAnomaly,
  normalizeAlias,
  seedAliasesFromAnomalies,
  similarity,
} from './seedAliasesFromAnomalies.js';

function freshDb(): DatabaseType {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  return db;
}

function seedTeam(db: DatabaseType, id: number, name: string): void {
  db.prepare('INSERT INTO teams (id, name, slug, division) VALUES (?, ?, ?, ?)').run(
    id,
    name,
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    'high-school',
  );
}

function seedIngestAnomaly(db: DatabaseType, rawLine: string, strategy: string): void {
  db.prepare(
    `INSERT INTO ingest_anomalies
       (source_post_id, source_url, raw_line, parent_game_id, strategy_attempted, reason, created_at)
     VALUES ('post-1', 'https://example.com/post-1', ?, NULL, ?, 'alias needed', '2026-04-25T00:00:00Z')`,
  ).run(rawLine, strategy);
}

describe('extractRawValueFromIngestAnomaly', () => {
  it('keeps schedule-team-resolve raw values as-is', () => {
    expect(
      extractRawValueFromIngestAnomaly({
        raw_line: 'West Chester Henderson',
        strategy_attempted: 'schedule-team-resolve',
      }),
    ).toBe('West Chester Henderson');
  });

  it('extracts the quoted team name from a laxnumbers anomaly', () => {
    expect(
      extractRawValueFromIngestAnomaly({
        raw_line: 'date=2026-04-22 unknown home team: "Cardinal OHara"',
        strategy_attempted: 'laxnumbers-unknown-team',
      }),
    ).toBe('Cardinal OHara');
  });
});

describe('seedAliasesFromAnomalies', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = freshDb();
    seedTeam(db, 1, "Cardinal O'Hara");
    seedTeam(db, 2, 'La Salle');
  });

  it('dry-runs high-confidence matches without inserting rows', () => {
    seedIngestAnomaly(db, 'date=2026-04-22 unknown home team: "Cardinal OHara"', 'laxnumbers-unknown-team');

    const summary = seedAliasesFromAnomalies(db, { dryRun: true });
    expect(summary.candidatesFound).toBe(1);
    expect(summary.autoSeeded).toBe(1);
    expect(summary.alreadyPresent).toBe(0);
    expect(summary.manualReview).toBe(0);

    const aliases = db.prepare('SELECT COUNT(*) AS c FROM team_aliases').get() as { c: number };
    expect(aliases.c).toBe(0);
  });

  it('applies high-confidence matches idempotently', () => {
    seedIngestAnomaly(db, 'Cardinal OHara', 'schedule-team-resolve');

    const first = seedAliasesFromAnomalies(db, { dryRun: false });
    expect(first.autoSeeded).toBe(1);
    expect(first.alreadyPresent).toBe(0);

    const row = db.prepare('SELECT alias, team_id, source FROM team_aliases').get() as {
      alias: string;
      team_id: number;
      source: string;
    };
    expect(row.alias).toBe(normalizeAlias('Cardinal OHara'));
    expect(row.team_id).toBe(1);
    expect(row.source).toBe('anomaly-auto-seed');

    const second = seedAliasesFromAnomalies(db, { dryRun: false });
    expect(second.autoSeeded).toBe(0);
    expect(second.alreadyPresent).toBe(1);
  });

  it('routes low-confidence matches to manual review', () => {
    seedIngestAnomaly(db, 'Mystery Academy', 'schedule-team-resolve');

    const summary = seedAliasesFromAnomalies(db, { dryRun: false });
    expect(summary.autoSeeded).toBe(0);
    expect(summary.manualReview).toBe(1);
  });
});

describe('similarity', () => {
  it('scores punctuation-only variants above the auto-seed threshold', () => {
    expect(similarity('Cardinal OHara', "Cardinal O'Hara")).toBeGreaterThanOrEqual(0.8);
  });
});
