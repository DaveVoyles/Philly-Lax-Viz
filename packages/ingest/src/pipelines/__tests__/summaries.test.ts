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

  it('Wave 12: 3 consecutive game blocks attribute stats to correct game', () => {
    const html = [
      '<p>Spring-Ford 10, Boyertown 5</p>',
      '<p>Spring-Ford</p>',
      '<p>Player A 4g 1a</p>',
      '<p>Boyertown</p>',
      '<p>Player B 3g 0a</p>',
      '<p>Methacton 8, Owen J. Roberts 7</p>',
      '<p>Methacton</p>',
      '<p>Player C 2g 1a</p>',
      '<p>OJR</p>',
      '<p>Player D 1g 0a</p>',
      '<p>Radnor 12, Marple Newtown 4</p>',
      '<p>Radnor</p>',
      '<p>Player E 5g</p>',
      '<p>Marple Newtown</p>',
      '<p>Player F 1g</p>',
    ].join('\n');
    db.prepare(`INSERT INTO teams (name, slug) VALUES ('Owen J. Roberts','owen-j-roberts')`).run();
    db.prepare(`INSERT INTO team_aliases (alias, team_id, source) VALUES ('ojr',(SELECT id FROM teams WHERE slug='owen-j-roberts'),'manual')`).run();
    const parsed = parseSummariesPost(html);
    expect(parsed.games.length).toBe(3);
    const r = ingestSummariesPost(db, {
      postId: 'w12-3blocks', postUrl: 'u', postDate: '2026-04-22', parsed,
    });
    expect(r.gamesUpserted).toBe(3);
    expect(r.playerStatsUpserted).toBe(6);
    const anomalies = (db.prepare(`SELECT COUNT(*) c FROM ingest_anomalies WHERE reason LIKE '%sub-header%'`).get() as { c: number }).c;
    expect(anomalies).toBe(0);
  });

  it('Wave 12: sub-header "Haverford" attributes to "Haverford School" home (partial-prefix match)', () => {
    // Pre-create both Haverford teams to reproduce the bug: findTeamByName
    // would resolve "Haverford" to "Haverford High" if the partial-match
    // preference for current-game teams isn't applied.
    db.prepare(`INSERT INTO teams (name, slug) VALUES ('Haverford School','haverford-school')`).run();
    db.prepare(`INSERT INTO teams (name, slug) VALUES ('Haverford High','haverford-high')`).run();
    db.prepare(`INSERT INTO teams (name, slug) VALUES ('Penn Charter','penn-charter')`).run();
    const html = [
      '<p>Haverford School 15, Penn Charter 4</p>',
      '<p>Haverford</p>',
      '<p>Conor Morsell 3g 3a</p>',
      '<p>Chris Burnetta 2g 1a</p>',
      '<p>Penn Charter</p>',
      '<p>Brady Place 2g</p>',
    ].join('\n');
    const parsed = parseSummariesPost(html);
    const r = ingestSummariesPost(db, {
      postId: 'w12-haverford', postUrl: 'u', postDate: '2026-04-22', parsed,
    });
    expect(r.playerStatsUpserted).toBe(3);
    const havSchoolPlayers = (db.prepare(`SELECT COUNT(*) c FROM players WHERE team_id=(SELECT id FROM teams WHERE slug='haverford-school')`).get() as { c: number }).c;
    const havHighPlayers = (db.prepare(`SELECT COUNT(*) c FROM players WHERE team_id=(SELECT id FROM teams WHERE slug='haverford-high')`).get() as { c: number }).c;
    expect(havSchoolPlayers).toBe(2);
    expect(havHighPlayers).toBe(0);
    const anomalies = (db.prepare(`SELECT COUNT(*) c FROM ingest_anomalies WHERE reason LIKE '%sub-header%'`).get() as { c: number }).c;
    expect(anomalies).toBe(0);
  });

  it('Wave 12: sub-header "WC Henderson" attributes to abbreviated "Henderson" home (suffix-word match)', () => {
    db.prepare(`INSERT INTO teams (name, slug) VALUES ('Henderson','henderson'),('Kennett','kennett'),('WC Henderson','wc-henderson')`).run();
    const html = [
      '<p>Henderson 12, Kennett 4</p>',
      '<p>WC Henderson</p>',
      '<p>Zach Abrahams 2g 4a</p>',
      '<p>Kennett</p>',
      '<p>Dylan Hartmann 1g</p>',
    ].join('\n');
    const parsed = parseSummariesPost(html);
    const r = ingestSummariesPost(db, {
      postId: 'w12-wch', postUrl: 'u', postDate: '2026-04-22', parsed,
    });
    expect(r.playerStatsUpserted).toBe(2);
    const hendPlayers = (db.prepare(`SELECT COUNT(*) c FROM players WHERE team_id=(SELECT id FROM teams WHERE slug='henderson')`).get() as { c: number }).c;
    expect(hendPlayers).toBe(1);
    const anomalies = (db.prepare(`SELECT COUNT(*) c FROM ingest_anomalies WHERE reason LIKE '%sub-header%'`).get() as { c: number }).c;
    expect(anomalies).toBe(0);
  });

  it('Wave 12: sub-header initials "PV" / "DB" attribute via initials match', () => {
    db.prepare(`INSERT INTO teams (name, slug) VALUES ('Perkiomen Valley','perkiomen-valley'),('Souderton','souderton')`).run();
    const html = [
      '<p>Perkiomen Valley 8, Souderton 7</p>',
      '<p>PV</p>',
      '<p>Player A 3g</p>',
      '<p>Souderton</p>',
      '<p>Player B 2g</p>',
    ].join('\n');
    const parsed = parseSummariesPost(html);
    const r = ingestSummariesPost(db, {
      postId: 'w12-pv', postUrl: 'u', postDate: '2026-04-22', parsed,
    });
    expect(r.playerStatsUpserted).toBe(2);
    const pvPlayers = (db.prepare(`SELECT COUNT(*) c FROM players WHERE team_id=(SELECT id FROM teams WHERE slug='perkiomen-valley')`).get() as { c: number }).c;
    expect(pvPlayers).toBe(1);
  });

  it('Wave 13: bare section sub-header "Goalie" defaults to home (no anomaly)', () => {
    db.prepare(`INSERT INTO teams (name, slug) VALUES ('Delaware Valley','delaware-valley'),('Wilkes-Barre','wilkes-barre')`).run();
    const html = [
      '<p>Delaware Valley 14, Wilkes-Barre 3</p>',
      '<p>Delaware Valley</p>',
      '<p>Player A 4g 1a</p>',
      '<p>Goalie</p>',
      '<p>Riley Smith 0g 0a</p>',
      '<p>Goalies:</p>',
      '<p>Nick Haag 0g 0a</p>',
    ].join('\n');
    const parsed = parseSummariesPost(html);
    const r = ingestSummariesPost(db, {
      postId: 'w13-goalie', postUrl: 'u', postDate: '2026-04-22', parsed,
    });
    expect(r.playerStatsUpserted).toBe(3);
    const dvPlayers = (db.prepare(`SELECT COUNT(*) c FROM players WHERE team_id=(SELECT id FROM teams WHERE slug='delaware-valley')`).get() as { c: number }).c;
    expect(dvPlayers).toBe(3);
    const dropped = (db.prepare(`SELECT COUNT(*) c FROM ingest_anomalies WHERE reason LIKE '%sub-header%'`).get() as { c: number }).c;
    expect(dropped).toBe(0);
  });

  it('Wave 13: "CBW FACEOFFS:" strips section keyword, resolves CBW via partial match', () => {
    db.prepare(`INSERT INTO teams (name, slug) VALUES ('Central Bucks West','central-bucks-west'),('Neshaminy','neshaminy')`).run();
    db.prepare(`INSERT INTO team_aliases (alias, team_id, source) VALUES ('cbw',(SELECT id FROM teams WHERE slug='central-bucks-west'),'manual')`).run();
    const html = [
      '<p>Central Bucks West 11, Neshaminy 6</p>',
      '<p>Central Bucks West</p>',
      '<p>Player A 4g</p>',
      '<p>CBW FACEOFFS:</p>',
      '<p>Ben Hutchinson 0g 0a</p>',
      '<p>Dominic Boyer 0g 0a</p>',
    ].join('\n');
    const parsed = parseSummariesPost(html);
    const r = ingestSummariesPost(db, {
      postId: 'w13-cbw-fo', postUrl: 'u', postDate: '2026-04-22', parsed,
    });
    expect(r.playerStatsUpserted).toBe(3);
    const cbwPlayers = (db.prepare(`SELECT COUNT(*) c FROM players WHERE team_id=(SELECT id FROM teams WHERE slug='central-bucks-west')`).get() as { c: number }).c;
    expect(cbwPlayers).toBe(3);
    const dropped = (db.prepare(`SELECT COUNT(*) c FROM ingest_anomalies WHERE reason LIKE '%sub-header%'`).get() as { c: number }).c;
    expect(dropped).toBe(0);
  });

  it('Wave 13: quarter-line teamHint resolves via partial match (Penn → Pennridge, PV initials → Perkiomen Valley)', () => {
    db.prepare(`INSERT INTO teams (name, slug) VALUES ('Pennridge','pennridge'),('Perkiomen Valley','perkiomen-valley')`).run();
    const html = [
      '<p>Pennridge 9, Perkiomen Valley 8</p>',
      '<p>Penn 2-3-1-3=9</p>',
      '<p>PV 1-2-3-2=8</p>',
    ].join('\n');
    const parsed = parseSummariesPost(html);
    const r = ingestSummariesPost(db, {
      postId: 'w13-ql-partial', postUrl: 'u', postDate: '2026-04-22', parsed,
    });
    // Quarter-line teamHint anomalies should be zero — "Penn" word-prefix
    // matches "Pennridge"; "PV" initials-match "Perkiomen Valley".
    const qlAnomalies = (db
      .prepare(`SELECT COUNT(*) c FROM ingest_anomalies WHERE reason LIKE '%team hint did not resolve%'`)
      .get() as { c: number }).c;
    expect(qlAnomalies).toBe(0);
    // 4 periods × 2 teams = 8 period rows.
    expect(r.periodsUpserted).toBe(8);
  });
});
