// commits.ts — GET /api/commits, /api/commits/colleges  (Wave 15 Lane 3).

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { countCommitsByCollege, listCommits } from '../queries/commits.js';
import { resolveSeason } from '../queries/seasons.js';
import { getImagesForSlugs } from '../queries/postImages.js';

interface CommitsQuery {
  season?: string;
  college?: string;
  limit?: string;
}

export async function commitsRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get<{ Querystring: CommitsQuery }>('/api/commits', async (req, reply) => {
    let season: number | null;
    try {
      season = resolveSeason(db, req.query.season);
    } catch (e) {
      reply.code(400);
      return { error: (e as Error).message };
    }
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
      reply.code(400);
      return { error: 'limit must be a positive integer' };
    }
    const rows = listCommits(db, {
      season,
      college: req.query.college,
      limit,
    });
    // Wave 17 Lane 2 (Han) -- batch-attach image URLs by source_post_id.
    const slugs = rows
      .map((r) => r.source_post_id)
      .filter((s): s is string => !!s);
    const imageMap = getImagesForSlugs(db, slugs);
    return {
      season,
      rows: rows.map((r) => ({
        id: r.id,
        playerId: r.player_id,
        playerName: r.player_name_raw,
        highSchoolTeamId: r.high_school_team_id,
        highSchoolName: r.high_school_name,
        highSchoolLogoUrl: r.high_school_logo_url ? `/logos/${r.high_school_logo_url}` : null,
        college: r.college,
        division: r.division,
        announcedDate: r.announced_date,
        sourceUrl: r.source_url,
        imageUrl: r.source_post_id ? imageMap.get(r.source_post_id)?.image_url ?? null : null,
      })),
    };
  });

  app.get<{ Querystring: CommitsQuery }>('/api/commits/colleges', async (req, reply) => {
    let season: number | null;
    try {
      season = resolveSeason(db, req.query.season);
    } catch (e) {
      reply.code(400);
      return { error: (e as Error).message };
    }
    const rows = countCommitsByCollege(db, { season });
    return { season, rows };
  });
}
