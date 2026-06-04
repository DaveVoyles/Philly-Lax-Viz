// W H4 L2 (Yoda) — header search-as-you-type endpoint.
//
// GET /api/search?q=<text>&limit=10
// Searches players.name + teams.name case-insensitively (LIKE %q%).
// Returns up to `limit` mixed results ranked: exact prefix match first,
// then alphabetical. Bails with [] when q.trim().length < 2.

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';

export interface SearchHit {
  kind: 'player' | 'team';
  id: number;
  name: string;
  teamName?: string;
}

interface SearchQuery {
  q?: string;
  limit?: string;
}

interface PlayerRow {
  id: number;
  name: string;
  team_name: string | null;
}

interface TeamRow {
  id: number;
  name: string;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function searchRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get<{ Querystring: SearchQuery }>('/api/search', async (req) => {
    const raw = (req.query.q ?? '').trim();
    if (raw.length < 2) return [] as SearchHit[];

    const limitParsed = Number.parseInt(req.query.limit ?? String(DEFAULT_LIMIT), 10);
    const limit = Number.isFinite(limitParsed) && limitParsed > 0
      ? Math.min(limitParsed, MAX_LIMIT)
      : DEFAULT_LIMIT;

    const lower = raw.toLowerCase();
    const containsPattern = `%${lower}%`;
    const prefixPattern = `${lower}%`;

    let players: PlayerRow[] = [];
    try {
      players = db.prepare(
        `SELECT p.id AS id, p.name AS name, t.name AS team_name
           FROM players p
           LEFT JOIN teams t ON t.id = p.team_id
          WHERE LOWER(p.name) LIKE ?
          ORDER BY (LOWER(p.name) LIKE ?) DESC, LOWER(p.name) ASC
          LIMIT ?`,
      ).all(containsPattern, prefixPattern, limit) as PlayerRow[];
    } catch (err) {
      app.log.error({ err }, '[search] players query failed');
      throw err;
    }

    let teams: TeamRow[] = [];
    try {
      teams = db.prepare(
        `SELECT id, name
           FROM teams
          WHERE LOWER(name) LIKE ?
          ORDER BY (LOWER(name) LIKE ?) DESC, LOWER(name) ASC
          LIMIT ?`,
      ).all(containsPattern, prefixPattern, limit) as TeamRow[];
    } catch (err) {
      app.log.error({ err }, '[search] teams query failed');
      throw err;
    }

    const hits: (SearchHit & { _prefix: number })[] = [];
    for (const t of teams) {
      hits.push({
        kind: 'team',
        id: t.id,
        name: t.name,
        _prefix: t.name.toLowerCase().startsWith(lower) ? 1 : 0,
      });
    }
    for (const p of players) {
      const hit: SearchHit & { _prefix: number } = {
        kind: 'player',
        id: p.id,
        name: p.name,
        _prefix: p.name.toLowerCase().startsWith(lower) ? 1 : 0,
      };
      if (p.team_name) hit.teamName = p.team_name;
      hits.push(hit);
    }

    hits.sort((a, b) => {
      if (a._prefix !== b._prefix) return b._prefix - a._prefix;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    return hits.slice(0, limit).map(({ _prefix: _p, ...rest }) => rest);
  });
}
