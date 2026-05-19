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
  app.get<{ Querystring: Query }>('/api/laxnumbers/ratings', cacheable, async (req) => {
    const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
    const view = req.query.view ? parseInt(req.query.view, 10) : 3454;

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
