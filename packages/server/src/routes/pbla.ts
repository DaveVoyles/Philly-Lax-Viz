// pbla.ts — API routes for PBLA (Philadelphia Box Lacrosse Association) data.
// Serves scraped Sportability data from the pbla_* tables.
// Also exposes a manual trigger endpoint for on-demand scraping.

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';

interface LeagueQuery {
  league_id?: string;
}

export async function pblaRoutes(app: FastifyInstance, db: Database): Promise<void> {
  // GET /api/pbla/standings?league_id=50731
  app.get<{ Querystring: LeagueQuery }>('/api/pbla/standings', async (req, reply) => {
    const leagueId = parseInt(req.query.league_id ?? '', 10) || null;
    const where = leagueId ? 'WHERE league_id = ?' : '';
    const params = leagueId ? [leagueId] : [];
    const rows = db.prepare(`SELECT * FROM pbla_teams ${where} ORDER BY pts DESC, diff DESC`).all(...params);
    return reply.send(rows);
  });

  // GET /api/pbla/players?league_id=50731
  app.get<{ Querystring: LeagueQuery }>('/api/pbla/players', async (req, reply) => {
    const leagueId = parseInt(req.query.league_id ?? '', 10) || null;
    const where = leagueId ? 'WHERE league_id = ?' : '';
    const params = leagueId ? [leagueId] : [];
    const rows = db.prepare(`SELECT * FROM pbla_players ${where} ORDER BY points DESC, goals DESC`).all(...params);
    return reply.send(rows);
  });

  // GET /api/pbla/goalies?league_id=50731
  app.get<{ Querystring: LeagueQuery }>('/api/pbla/goalies', async (req, reply) => {
    const leagueId = parseInt(req.query.league_id ?? '', 10) || null;
    const where = leagueId ? 'WHERE league_id = ?' : '';
    const params = leagueId ? [leagueId] : [];
    const rows = db.prepare(`SELECT * FROM pbla_goalies ${where} ORDER BY gaa ASC`).all(...params);
    return reply.send(rows);
  });

  // GET /api/pbla/games?league_id=50731
  app.get<{ Querystring: LeagueQuery }>('/api/pbla/games', async (req, reply) => {
    const leagueId = parseInt(req.query.league_id ?? '', 10) || null;
    const where = leagueId ? 'WHERE league_id = ?' : '';
    const params = leagueId ? [leagueId] : [];
    const rows = db.prepare(`SELECT * FROM pbla_games ${where} ORDER BY game_num DESC`).all(...params);
    return reply.send(rows);
  });

  // GET /api/pbla/scrape-log — recent scrape history for observability
  app.get('/api/pbla/scrape-log', async (_req, reply) => {
    const rows = db.prepare('SELECT * FROM pbla_scrape_log ORDER BY scraped_at DESC LIMIT 30').all();
    return reply.send(rows);
  });

  // POST /api/pbla/scrape — trigger an on-demand scrape (useful for testing)
  app.post<{ Body: { league_id?: number; cookies?: string } }>('/api/pbla/scrape', async (req, reply) => {
    const leagueId = req.body?.league_id ?? getCurrentLeagueId();
    const cookies = req.body?.cookies ?? process.env.SPORTABILITY_COOKIES;

    try {
      const { syncPbla } = await import('@pll/ingest/src/scripts/syncPbla.js');
      const dbPath = process.env.DB_PATH ?? process.env.PLL_DB_PATH ?? '';
      const result = await syncPbla({ leagueId, dryRun: false, cookies, dbPath });
      return reply.send({
        status: 'ok',
        teams: result?.teams.length ?? 0,
        players: result?.players.length ?? 0,
        goalies: result?.goalies.length ?? 0,
        games: result?.games.length ?? 0,
      });
    } catch (err) {
      return reply.status(500).send({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

function getCurrentLeagueId(): number {
  const year = new Date().getFullYear();
  const ids: Record<number, number> = { 2025: 50247, 2026: 50731 };
  return ids[year] ?? 50731;
}
