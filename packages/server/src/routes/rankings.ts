import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getStatements } from '../queries/statements.js';
import { cacheable } from '../plugins/responseCache.js';
import {
  mapRanking,
  mapTeam,
  type RankingRow,
  type TeamRow,
} from '../queries/mappers.js';

interface Query {
  week?: string;
  source?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Valid source values (post-normalization)
const ALLOWED_SOURCES = new Set(['philly', 'pa-state']);

// Spec accepts ?source=phillylax; shared types use 'philly'/'pa-state'.
// Map common aliases so the public API is forgiving. Returns undefined when
// caller didn't supply one — caller then queries across all sources.
// Returns false when the value is supplied but not a recognized source.
function normalizeSource(s: string | undefined): string | undefined | false {
  if (!s) return undefined;
  if (s === 'phillylax') return 'philly';
  const normalized = s;
  if (!ALLOWED_SOURCES.has(normalized)) return false;
  return normalized;
}

export async function rankingsRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const s = getStatements(db);

  app.get<{ Querystring: Query }>('/api/rankings', cacheable, async (req, reply) => {
    const source = normalizeSource(req.query.source);
    if (source === false) {
      reply.code(400);
      return { error: 'BadRequest', message: `Unknown source. Allowed: ${[...ALLOWED_SOURCES].join(', ')}` };
    }

    let week = req.query.week;
    if (week !== undefined && !ISO_DATE.test(week)) {
      reply.code(400);
      return { error: 'BadRequest', message: 'week must be YYYY-MM-DD' };
    }

    if (!week) {
      const row = (source
        ? s.latestRankingWeek.get(source)
        : s.latestRankingWeekAnySource.get()) as { week_start: string } | undefined;
      if (!row) return [];
      week = row.week_start;
    }

    const rows = (source
      ? s.rankingsForWeek.all(week, source)
      : s.rankingsForWeekAnySource.all(week)) as RankingRow[];
    return rows.map((r) => {
      const teamRow = s.getTeamById.get(r.team_id) as TeamRow | undefined;
      return {
        ...mapRanking(r),
        team: teamRow ? mapTeam(teamRow) : null,
      };
    });
  });
}
