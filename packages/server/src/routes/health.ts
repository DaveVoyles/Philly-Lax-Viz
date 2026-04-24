import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getStatements } from '../queries/statements.js';
import { getSnapshotEpoch } from '../snapshot.js';

// Bumped when the response shape changes. Consumers (Docker healthcheck,
// monitoring) can compare against this. W17 L3 (R2) added richer fields.
const HEALTH_VERSION = '0.2.0';

export async function healthRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const s = getStatements(db);

  app.get('/api/health', async () => {
    const num = (stmt: import('better-sqlite3').Statement): number => {
      const row = stmt.get() as { c: number };
      return row.c;
    };

    let schemaVersion: number | null = null;
    try {
      const row = db.prepare('PRAGMA user_version').get() as { user_version?: number };
      schemaVersion = typeof row?.user_version === 'number' ? row.user_version : null;
    } catch {
      schemaVersion = null;
    }

    interface SeasonRow { season: number; games: number }
    let seasons: SeasonRow[] = [];
    try {
      seasons = db
        .prepare('SELECT season, COUNT(*) AS games FROM games GROUP BY season ORDER BY season DESC')
        .all() as SeasonRow[];
    } catch {
      seasons = [];
    }

    const counts = {
      teams: num(s.countTeams),
      games: num(s.countGames),
      players: num(s.countPlayers),
      playerStats: num(s.countPlayerStats),
      rankings: num(s.countRankings),
      anomalies: num(s.countAnomalies),
    };

    return {
      // Back-compat fields (existing tests + getServerHealth() consumer).
      ok: true,
      dbRows: counts,
      // W17 spec fields.
      status: 'ok',
      version: HEALTH_VERSION,
      dbPath: process.env['DB_PATH'] ?? process.env['PLL_DB_PATH'] ?? null,
      schemaVersion,
      seasons: seasons.map((r) => ({ year: r.season, games: r.games })),
      counts,
      snapshotEpoch: getSnapshotEpoch(),
    };
  });
}
