import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../db.js';
import {
  buildReport,
  renderMarkdown,
  classifyDifficulty,
} from './anomalyTriage.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  return db;
}

function insertAnomaly(
  db: Database.Database,
  postId: string,
  strategy: string,
  reason: string,
  rawLine: string,
): void {
  db.prepare(
    `INSERT INTO ingest_anomalies
       (source_post_id, source_url, raw_line, parent_game_id, strategy_attempted, reason, created_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    postId,
    `https://example.test/posts/${postId}`,
    rawLine,
    strategy,
    reason,
    '2026-04-22T00:00:00Z',
  );
}

describe('anomalyTriage', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('handles an empty database without crashing', () => {
    const report = buildReport(db);
    expect(report.totalAnomalies).toBe(0);
    expect(report.uniqueGroups).toBe(0);
    expect(report.topGroups).toEqual([]);
    const md = renderMarkdown(report);
    expect(md).toContain('# Ingest Anomaly Triage');
    expect(md).toContain('Total anomalies: **0**');
  });

  it('groups, counts, and pulls samples from a populated database', () => {
    for (let i = 0; i < 7; i++) {
      insertAnomaly(
        db,
        `p-quarter-${i}`,
        'quarter-line',
        'team hint did not resolve to either side of the score line',
        `quarter line teamHint="ABC${i}" did not match X | Y`,
      );
    }
    for (let i = 0; i < 3; i++) {
      insertAnomaly(
        db,
        `p-stat-${i}`,
        'player-stat-line',
        'no stat tokens recognized in line',
        `mystery line ${i}`,
      );
    }
    insertAnomaly(
      db,
      'p-score-1',
      'score-line',
      'score line did not match Team A N, Team B N pattern',
      'Team A 5 Team B 3',
    );

    const report = buildReport(db, 10);
    expect(report.totalAnomalies).toBe(11);
    expect(report.uniqueGroups).toBe(3);
    expect(report.topGroups.length).toBe(3);

    const top = report.topGroups[0]!;
    expect(top.strategy).toBe('quarter-line');
    expect(top.count).toBe(7);
    // Samples capped at 5 per group.
    expect(top.samples.length).toBe(5);
    expect(top.samples[0]!.rawLine).toContain('teamHint');
    expect(top.samples[0]!.sourceUrl).toMatch(/^https:\/\/example\.test\//);
    expect(top.difficulty).toBe('M');

    const md = renderMarkdown(report);
    expect(md).toContain('Total anomalies: **11**');
    expect(md).toContain('| 1 | quarter-line |');
    expect(md).toContain('| 2 | player-stat-line |');
    // ASCII-only: no em-dash
    expect(md).not.toMatch(/\u2014/);
  });

  it('respects the topN limit', () => {
    insertAnomaly(db, 'p1', 'a', 'r1', 'line a');
    insertAnomaly(db, 'p2', 'b', 'r2', 'line b');
    insertAnomaly(db, 'p3', 'c', 'r3', 'line c');
    const report = buildReport(db, 2);
    expect(report.uniqueGroups).toBe(3);
    expect(report.topGroups.length).toBe(2);
  });

  it('classifies known patterns deterministically', () => {
    expect(
      classifyDifficulty(
        'quarter-line',
        'team hint did not resolve to either side of the score line',
      ).difficulty,
    ).toBe('M');
    expect(
      classifyDifficulty('quarter-line', 'period sum does not equal total -- periods stored anyway')
        .difficulty,
    ).toBe('S');
    expect(
      classifyDifficulty('ranking-list', 'duplicate rank 3 in post').difficulty,
    ).toBe('S');
    expect(classifyDifficulty('something-new', 'mystery').difficulty).toBe('M');
  });

  it('sanitizes em-dashes and smart quotes in markdown output', () => {
    insertAnomaly(
      db,
      'p1',
      'quarter-line',
      'period sum does not equal total \u2014 periods stored anyway',
      'raw \u201Cquoted\u201D line \u2014 with dash',
    );
    const report = buildReport(db);
    const md = renderMarkdown(report);
    expect(md).not.toMatch(/[\u2014\u2013\u2018\u2019\u201C\u201D]/);
    expect(md).toContain('--');
  });
});
