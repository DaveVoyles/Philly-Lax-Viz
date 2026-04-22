// queries/piaa.ts — alias-aware PIAA join helper.
//
// Returns the PIAA District 1 official record for a given internal team id,
// joining via either:
//   1. the team's own name (LOWER(teams.name) = piaa.name_normalized), or
//   2. an entry in team_aliases (alias = piaa.name_normalized).
//
// Returns null when no PIAA row matches. The two predicates are OR-ed in a
// single statement so callers don't need to know whether a particular team
// requires an alias hop. See seedTeamAliases for the alias rows we ship.

import type { Database } from 'better-sqlite3';

export interface PiaaRecord {
  name_official: string;
  classification: string;
  seed: number | null;
  wins: number;
  losses: number;
  ties: number;
  total_points: number;
  ranking: number;
}

const SQL = `
  SELECT p.name_official,
         p.classification,
         p.seed,
         p.wins,
         p.losses,
         p.ties,
         p.total_points,
         p.ranking
    FROM piaa_official_teams p
    JOIN teams t ON t.id = ?
   WHERE p.name_normalized = LOWER(t.name)
      OR p.name_normalized IN (
           SELECT alias FROM team_aliases WHERE team_id = t.id
         )
   ORDER BY p.ranking DESC
   LIMIT 1
`;

/**
 * Look up the PIAA official record for an internal team id.
 *
 * Returns null when no matching PIAA row exists (covers teams not in PIAA
 * District 1, teams without an alias mapping, or genuinely unranked rows).
 *
 * If a team somehow matches multiple PIAA rows (e.g. same name in multiple
 * classifications), the highest-ranking row is returned — deterministic
 * but conservative; callers shouldn't depend on this tiebreaker.
 */
export function getPiaaForTeam(db: Database, teamId: number): PiaaRecord | null {
  const row = db.prepare(SQL).get(teamId) as PiaaRecord | undefined;
  return row ?? null;
}
