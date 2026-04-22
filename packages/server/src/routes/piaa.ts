// PIAA D1 cross-check route — surfaces discrepancies between our derived
// `teams`/`games` data and the official PIAA District 1 boys lacrosse rankings
// snapshot stored in `piaa_official_teams` (populated by syncPiaa.ts).

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';

interface PiaaRow {
  name_official: string;
  name_normalized: string;
  classification: string;
  seed: number | null;
  wins: number;
  losses: number;
  ties: number;
  ranking: number;
  fetched_at: string;
}

interface OurTeamAgg {
  id: number;
  name: string;
  games: number;
  wins: number;
  losses: number;
}

/** Local normalizer — mirrors `packages/ingest/src/sources/piaa.ts`. */
function normalize(raw: string): string {
  let s = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  const stateMatch = s.match(/\((nj|ny)\)/);
  const stateTag = stateMatch ? ` (${stateMatch[1]})` : '';
  s = s.replace(/\s*\([^)]*\)/g, '');
  s = s.replace(/[^a-z0-9 ]+/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s + stateTag;
}

export async function piaaRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get('/api/data-quality/piaa-mismatches', async () => {
    // 1. Pull PIAA snapshot.
    const piaaRows = db
      .prepare(
        `SELECT name_official, name_normalized, classification, seed, wins, losses, ties, ranking, fetched_at
         FROM piaa_official_teams
         ORDER BY classification, ranking`,
      )
      .all() as PiaaRow[];

    const fetchedAt = piaaRows.length > 0 ? (piaaRows[0]?.fetched_at ?? '') : '';

    // 2. Pull our teams + derive W/L from non-postponed games.
    const ourRows = db
      .prepare(
        `SELECT
            t.id   AS id,
            t.name AS name,
            COALESCE(SUM(CASE WHEN g.id IS NOT NULL AND g.postponed = 0 THEN 1 ELSE 0 END), 0) AS games,
            COALESCE(SUM(CASE
              WHEN g.postponed = 0 AND (
                (g.home_team_id = t.id AND g.home_score > g.away_score) OR
                (g.away_team_id = t.id AND g.away_score > g.home_score)
              ) THEN 1 ELSE 0 END), 0) AS wins,
            COALESCE(SUM(CASE
              WHEN g.postponed = 0 AND (
                (g.home_team_id = t.id AND g.home_score < g.away_score) OR
                (g.away_team_id = t.id AND g.away_score < g.home_score)
              ) THEN 1 ELSE 0 END), 0) AS losses
         FROM teams t
         LEFT JOIN games g
           ON g.home_team_id = t.id OR g.away_team_id = t.id
         GROUP BY t.id, t.name`,
      )
      .all() as OurTeamAgg[];

    // 3. Build normalized indexes on both sides.
    interface OurEntry extends OurTeamAgg {
      normalized: string;
    }
    const ourByNorm = new Map<string, OurEntry>();
    for (const r of ourRows) {
      const n = normalize(r.name);
      // If multiple teams normalize to same key (parenthetical-suffix dupes
      // from before Han's dedup), prefer the one with more games.
      const existing = ourByNorm.get(n);
      if (!existing || r.games > existing.games) {
        ourByNorm.set(n, { ...r, normalized: n });
      }
    }

    const piaaByNorm = new Map<string, PiaaRow>();
    for (const r of piaaRows) {
      // Same dedup tactic — prefer higher classification record if both 2A/3A
      // ever list the same school (they shouldn't, but be safe).
      if (!piaaByNorm.has(r.name_normalized)) piaaByNorm.set(r.name_normalized, r);
    }

    // 4. Categorize.
    const missingInOurDb: { classification: string; nameOfficial: string; ranking: number }[] = [];
    for (const [norm, p] of piaaByNorm) {
      if (!ourByNorm.has(norm)) {
        missingInOurDb.push({
          classification: p.classification,
          nameOfficial: p.name_official,
          ranking: p.ranking,
        });
      }
    }
    missingInOurDb.sort(
      (a, b) =>
        a.classification.localeCompare(b.classification) || b.ranking - a.ranking,
    );

    const extraInOurDb: { teamId: number; teamName: string; gamesInDb: number }[] = [];
    for (const [norm, o] of ourByNorm) {
      if (!piaaByNorm.has(norm)) {
        extraInOurDb.push({ teamId: o.id, teamName: o.name, gamesInDb: o.games });
      }
    }
    extraInOurDb.sort((a, b) => b.gamesInDb - a.gamesInDb || a.teamName.localeCompare(b.teamName));

    const recordMismatches: {
      teamId: number;
      teamName: string;
      ours: { wins: number; losses: number };
      piaa: { wins: number; losses: number; classification: string };
    }[] = [];
    let matched = 0;
    for (const [norm, p] of piaaByNorm) {
      const o = ourByNorm.get(norm);
      if (!o) continue;
      matched += 1;
      if (o.wins !== p.wins || o.losses !== p.losses) {
        recordMismatches.push({
          teamId: o.id,
          teamName: o.name,
          ours: { wins: o.wins, losses: o.losses },
          piaa: { wins: p.wins, losses: p.losses, classification: p.classification },
        });
      }
    }
    recordMismatches.sort(
      (a, b) =>
        Math.abs(b.ours.wins + b.ours.losses - (b.piaa.wins + b.piaa.losses)) -
          Math.abs(a.ours.wins + a.ours.losses - (a.piaa.wins + a.piaa.losses)) ||
        a.teamName.localeCompare(b.teamName),
    );

    return {
      fetchedAt,
      summary: {
        ourTeamCount: ourByNorm.size,
        piaaTeamCount: piaaByNorm.size,
        matched,
        missingInOurDb: missingInOurDb.length,
        extraInOurDb: extraInOurDb.length,
        recordMismatches: recordMismatches.length,
      },
      missingInOurDb,
      extraInOurDb,
      recordMismatches,
    };
  });
}
