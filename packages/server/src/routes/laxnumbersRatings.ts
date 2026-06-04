import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { cacheable } from '../plugins/responseCache.js';

interface Query {
  year?: string;
  view?: string;
}

interface RatingRow {
  id: number;
  team_id: number;
  laxnumbers_team_id: number;
  view_id: number;
  year: number;
  ranking: number;
  rating: number;
  agd: number;
  sched: number;
  wins: number;
  losses: number;
  ties: number;
  gf: number;
  ga: number;
  captured_at: string;
  team_name: string;
  team_slug: string;
  logo_url: string | null;
}

export async function laxnumbersRatingsRoutes(
  app: FastifyInstance,
  db: Database,
): Promise<void> {
  const getAll = db.prepare(`
    SELECT lr.*, t.name AS team_name, t.slug AS team_slug, t.logo_url
    FROM laxnumbers_ratings lr
    JOIN teams t ON lr.team_id = t.id
    WHERE lr.year = ? AND lr.view_id = ?
    ORDER BY lr.ranking ASC
  `);

  const getForTeam = db.prepare(`
    SELECT lr.*, t.name AS team_name, t.slug AS team_slug, t.logo_url
    FROM laxnumbers_ratings lr
    JOIN teams t ON lr.team_id = t.id
    WHERE lr.team_id = ?
    ORDER BY lr.year DESC
  `);

  // GET /api/laxnumbers/ratings?year=2026&view=3454
  app.get<{ Querystring: Query }>('/api/laxnumbers/ratings', cacheable, async (req, reply) => {
    const yearRaw = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
    const viewRaw = req.query.view ? parseInt(req.query.view, 10) : undefined;

    if (!Number.isInteger(yearRaw) || yearRaw < 2000 || yearRaw > 2100) {
      return reply.status(400).send({ error: 'BadRequest', message: 'year must be a valid integer' });
    }
    if (req.query.view !== undefined && (!Number.isInteger(viewRaw) || viewRaw! <= 0)) {
      return reply.status(400).send({ error: 'BadRequest', message: 'view must be a positive integer' });
    }

    // If no view specified, pick the most-recently captured view for the year
    let effectiveView = viewRaw;
    if (effectiveView === undefined) {
      const latest = db.prepare(
        `SELECT view_id FROM laxnumbers_ratings WHERE year = ? ORDER BY captured_at DESC LIMIT 1`,
      ).get(yearRaw) as { view_id: number } | undefined;
      if (!latest) return [];
      effectiveView = latest.view_id;
    }

    const year = yearRaw;
    const view = effectiveView;
    const rows = getAll.all(year, view) as RatingRow[];
    return rows.map((r) => ({
      teamId: r.team_id,
      teamName: r.team_name,
      teamSlug: r.team_slug,
      logoUrl: r.logo_url,
      laxnumbersTeamId: r.laxnumbers_team_id,
      viewId: r.view_id,
      year: r.year,
      ranking: r.ranking,
      rating: r.rating,
      agd: r.agd,
      sched: r.sched,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      gf: r.gf,
      ga: r.ga,
      capturedAt: r.captured_at,
    }));
  });

  // GET /api/laxnumbers/ratings/team/:teamId — history for a single team
  app.get<{ Params: { teamId: string } }>(
    '/api/laxnumbers/ratings/team/:teamId',
    cacheable,
    async (req) => {
      const teamId = parseInt(req.params.teamId, 10);
      if (isNaN(teamId)) return [];
      const rows = getForTeam.all(teamId) as RatingRow[];
      return rows.map((r) => ({
        viewId: r.view_id,
        year: r.year,
        ranking: r.ranking,
        rating: r.rating,
        agd: r.agd,
        sched: r.sched,
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        gf: r.gf,
        ga: r.ga,
        capturedAt: r.captured_at,
      }));
    },
  );
}
