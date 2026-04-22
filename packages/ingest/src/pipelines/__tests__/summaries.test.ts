import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../../db.js';
import { ingestSummariesPost } from '../summaries.js';
import { parseSummariesPost } from '../../parsers/summariesPost.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, '../../../../../fixtures/summaries-sample.html');
const fixtureHtml = readFileSync(fixturePath, 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  return db;
}

describe('ingestSummariesPost (live fixture)', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it('populates teams, games, periods, players, player_stats; is idempotent', () => {
    const parsed = parseSummariesPost(fixtureHtml);
    const input = {
      postId: 'tuesday-boys-summaries-fixture',
      postUrl: 'https://example/sum',
      postDate: '2026-04-21',
      parsed,
    };
    const r1 = ingestSummariesPost(db, input);
    expect(r1.gamesUpserted).toBeGreaterThanOrEqual(20);
    // After 0.2.0 parser fix: stats with uncertain team attribution are now
    // dropped (anomaly'd) instead of misattributed to home. The fixture's true
    // confidently-attributed stat count is ~50-100 depending on sub-header
    // recognition; we keep a conservative floor here.
    expect(r1.playerStatsUpserted).toBeGreaterThanOrEqual(50);

    const counts = (sql: string) =>
      (db.prepare(sql).get() as { c: number }).c;
    const teams1 = counts('SELECT COUNT(*) c FROM teams');
    const games1 = counts('SELECT COUNT(*) c FROM games');
    const periods1 = counts('SELECT COUNT(*) c FROM game_periods');
    const players1 = counts('SELECT COUNT(*) c FROM players');
    const stats1 = counts('SELECT COUNT(*) c FROM player_stats');
    expect(teams1).toBeGreaterThan(20);
    expect(games1).toBeGreaterThanOrEqual(20);
    expect(periods1).toBeGreaterThan(0);
    expect(players1).toBeGreaterThan(40);
    expect(stats1).toBeGreaterThan(40);

    // Re-run: counts must not change.
    const r2 = ingestSummariesPost(db, input);
    expect(r2.gamesUpserted).toBe(r1.gamesUpserted);
    const teams2 = counts('SELECT COUNT(*) c FROM teams');
    const games2 = counts('SELECT COUNT(*) c FROM games');
    const periods2 = counts('SELECT COUNT(*) c FROM game_periods');
    const players2 = counts('SELECT COUNT(*) c FROM players');
    const stats2 = counts('SELECT COUNT(*) c FROM player_stats');
    expect(teams2).toBe(teams1);
    expect(games2).toBe(games1);
    expect(periods2).toBe(periods1);
    expect(players2).toBe(players1);
    expect(stats2).toBe(stats1);
  });

  it('reconciles with a pre-existing scoreboard-created game (does not overwrite scores)', () => {
    // Find a game from the fixture and seed it under a fixed score from the
    // "scoreboard" path first, then ingest summaries — score should not be
    // overwritten by summaries (scoreboard is authoritative).
    const parsed = parseSummariesPost(fixtureHtml);
    const block = parsed.games.find((g) => g.scoreLine.teamA === 'Spring-Ford');
    expect(block).toBeDefined();
    const home = block!.scoreLine.teamA;
    const away = block!.scoreLine.teamB;

    const insertTeam = db.prepare(
      `INSERT INTO teams (name, slug) VALUES (?, ?) RETURNING id`,
    );
    const homeId = (insertTeam.get(home, 'spring-ford') as { id: number }).id;
    const awayId = (insertTeam.get(away, 'boyertown') as { id: number }).id;
    db.prepare(
      `INSERT INTO games (date, home_team_id, away_team_id, home_score, away_score,
         ot_periods, postponed, source_post_id, parsed_at)
       VALUES (?, ?, ?, 99, 99, 0, 0, 'scoreboard-seed', ?)`,
    ).run('2026-04-21', homeId, awayId, new Date().toISOString());

    ingestSummariesPost(db, {
      postId: 'summaries-x',
      postUrl: 'u',
      postDate: '2026-04-21',
      parsed,
    });

    const game = db
      .prepare(`SELECT home_score, away_score, recap_url FROM games
                WHERE date='2026-04-21' AND home_team_id=? AND away_team_id=?`)
      .get(homeId, awayId) as { home_score: number; away_score: number; recap_url: string };
    expect(game.home_score).toBe(99);
    expect(game.away_score).toBe(99);
    expect(game.recap_url).toBe('u');
  });

  it('resolves "<Team> Scorers:" sub-headers via suffix-strip and aliases (Wave 11)', () => {
    // Construct a synthetic two-game body where one block uses an aliased
    // abbreviation + "Scorers:" suffix to exercise the W11 sub-header
    // normalization path in `assignAndUpsertPlayerStats`.
    const html = [
      '<p>Spring-Ford 10, Boyertown 5</p>',
      '<p>Spring-Ford 3 1 5 1 - 10</p>',
      '<p>Boyertown 1 0 2 2 - 5</p>',
      '<p>SF Scorers:</p>',
      '<p>Player A 4g 1a</p>',
      '<p>Player B 3g 0a</p>',
      '<p>BTN Scoring</p>',
      '<p>Player C 2g 1a</p>',
      '<p>Player D 1g 0a</p>',
    ].join('\n');

    // Pre-create teams + aliases for the abbreviations.
    const sf = db.prepare(`INSERT INTO teams (name, slug) VALUES ('Spring-Ford', 'spring-ford') RETURNING id`).get() as { id: number };
    const btn = db.prepare(`INSERT INTO teams (name, slug) VALUES ('Boyertown', 'boyertown') RETURNING id`).get() as { id: number };
    db.prepare(`INSERT INTO team_aliases (alias, team_id, source) VALUES ('sf', ?, 'manual'), ('btn', ?, 'manual')`).run(sf.id, btn.id);

    const parsed = parseSummariesPost(html);
    expect(parsed.games.length).toBe(1);
    expect(parsed.games[0]!.playerStats.length).toBe(4);

    const r = ingestSummariesPost(db, {
      postId: 'w11-suffix-test',
      postUrl: 'https://example/w11',
      postDate: '2026-04-22',
      parsed,
    });

    expect(r.gamesUpserted).toBe(1);
    expect(r.playerStatsUpserted).toBe(4);
    // No "uncertain team" anomalies should remain.
    const anomalyCount = (db
      .prepare(`SELECT COUNT(*) c FROM ingest_anomalies WHERE reason LIKE '%sub-header%'`)
      .get() as { c: number }).c;
    expect(anomalyCount).toBe(0);

    const sfPlayers = (db
      .prepare(`SELECT COUNT(*) c FROM players WHERE team_id = ?`)
      .get(sf.id) as { c: number }).c;
    const btnPlayers = (db
      .prepare(`SELECT COUNT(*) c FROM players WHERE team_id = ?`)
      .get(btn.id) as { c: number }).c;
    expect(sfPlayers).toBe(2);
    expect(btnPlayers).toBe(2);
  });
});
