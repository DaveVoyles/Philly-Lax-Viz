// W17 L3 (R2) — data freshness for the global footer + Sources page.
//
// GET /api/freshness
// Returns the most recent timestamp seen for each major ingest stream so the
// UI can render "Last scoreboard update: <time>" and the Sources explainer.
//
// Each value is either an ISO-8601 string or null (table empty / not yet
// populated). All queries are wrapped in try/catch so a missing optional
// table (e.g. team_logos before W?) does not 500 the endpoint.

import type { FastifyInstance } from 'fastify';
import type { Database, Statement } from 'better-sqlite3';

interface CountRow { c: number }

function safeScalar<T = string | null>(db: Database, sql: string): T | null {
  try {
    const stmt: Statement = db.prepare(sql);
    const row = stmt.get() as Record<string, unknown> | undefined;
    if (!row) return null;
    const first = Object.values(row)[0];
    return (first === undefined ? null : (first as T));
  } catch {
    return null;
  }
}

function safeCount(db: Database, sql: string): number {
  try {
    const row = db.prepare(sql).get() as CountRow | undefined;
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

export async function freshnessRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get('/api/freshness', async () => {
    const scoreboardLast = safeScalar<string>(
      db,
      "SELECT MAX(processed_at) AS t FROM ingest_post_log WHERE category = 'scoreboard'",
    );
    const recapsLast = safeScalar<string>(
      db,
      "SELECT MAX(processed_at) AS t FROM ingest_post_log WHERE category = 'hs-summaries'",
    );
    const rankingsLast = safeScalar<string>(
      db,
      "SELECT MAX(processed_at) AS t FROM ingest_post_log WHERE category = 'rankings'",
    );
    const scheduleLast = safeScalar<string>(
      db,
      'SELECT MAX(scraped_at) AS t FROM schedule_games',
    );
    const piaaLast = safeScalar<string>(
      db,
      'SELECT MAX(fetched_at) AS t FROM piaa_official_teams',
    );
    const aliasesLast = safeScalar<string>(
      db,
      'SELECT MAX(created_at) AS t FROM player_aliases',
    );
    const anyLast = safeScalar<string>(
      db,
      'SELECT MAX(processed_at) AS t FROM ingest_post_log',
    );

    return {
      scoreboardLast,
      recapsLast,
      rankingsLast,
      scheduleLast,
      piaaLast,
      aliasesLast,
      lastIngestAt: anyLast,
      counts: {
        teams: safeCount(db, 'SELECT COUNT(*) AS c FROM teams'),
        games: safeCount(db, 'SELECT COUNT(*) AS c FROM games'),
        players: safeCount(db, 'SELECT COUNT(*) AS c FROM players'),
        scheduleGames: safeCount(db, 'SELECT COUNT(*) AS c FROM schedule_games'),
        playerAliases: safeCount(db, 'SELECT COUNT(*) AS c FROM player_aliases'),
        piaaTeams: safeCount(db, 'SELECT COUNT(*) AS c FROM piaa_official_teams'),
      },
      generatedAt: new Date().toISOString(),
    };
  });
}
