// laxnumbersRatings.ts — Fetch and store LaxNumbers team ratings from their JSON API.
//
// Data source: GET /ratings/service?y={year}&v={view_id}
// Returns JSON array with per-team: team_nbr, name, ranking, rating, agd, sched,
// wins, losses, ties, gf, ga, logo_large_url, web, social links.
//
// Views we track:
//   3454 — PA East (public school conference)
//   3468 — PA East IAC/Private

import type { Database as DatabaseType } from 'better-sqlite3';
import { findTeamByName } from './teamResolver.js';

const BASE_URL = 'https://laxnumbers.com/ratings/service';
const USER_AGENT =
  'PhillyLacrosseVis/1.0 (data-aggregation; github.com/phillylacrosse)';

// Default views to scrape
export const DEFAULT_VIEWS = [
  { id: 3454, label: 'PA East' },
  { id: 3468, label: 'PA East IAC/Private' },
];

// ─── Types ──────────────────────────────────────────────────────────────────

/** Raw shape returned by the LaxNumbers ratings API. */
export interface LaxRawRating {
  team_nbr: number;
  name: string;
  ranking: number;
  rating: number;
  agd: number;
  sched: number;
  wins: number;
  losses: number;
  ties: number;
  gp: number;
  gf: number;
  ga: number;
  state: string;
  web: string | null;
  logo_large_url: string | null;
  facebook: string | null;
  twitter: string | null;
  instagram: string | null;
  div_rank_live: number;
  adj_average: number;
  suffix: string;
}

export interface LaxNumbersRatingsOpts {
  year: number;
  views?: Array<{ id: number; label: string }>;
  apply: boolean;
  fetch?: typeof globalThis.fetch;
}

export interface RatingsSyncAnomaly {
  kind: string;
  detail: string;
}

export interface RatingsSyncResult {
  fetched: number;
  resolved: number;
  unresolved: number;
  upserted: number;
  teamIdsMapped: number;
  anomalies: RatingsSyncAnomaly[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fetch ratings for a single view with retry. */
async function fetchRatings(
  year: number,
  viewId: number,
  fetchFn: typeof globalThis.fetch,
): Promise<LaxRawRating[]> {
  const url = `${BASE_URL}?y=${year}&v=${viewId}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(600 * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetchFn(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
      });
      clearTimeout(timer);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as LaxRawRating[];
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`fetch failed for ratings view ${viewId}`);
}

// ─── Main Pipeline ──────────────────────────────────────────────────────────

export async function runLaxNumbersRatings(
  db: DatabaseType,
  opts: LaxNumbersRatingsOpts,
): Promise<RatingsSyncResult> {
  const { year, apply } = opts;
  const views = opts.views ?? DEFAULT_VIEWS;
  const fetchFn = opts.fetch ?? globalThis.fetch;

  const result: RatingsSyncResult = {
    fetched: 0,
    resolved: 0,
    unresolved: 0,
    upserted: 0,
    teamIdsMapped: 0,
    anomalies: [],
  };

  // Prepare statements
  const upsertRating = db.prepare(`
    INSERT INTO laxnumbers_ratings (team_id, laxnumbers_team_id, view_id, year, ranking, rating, agd, sched, wins, losses, ties, gf, ga, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (team_id, view_id, year) DO UPDATE SET
      laxnumbers_team_id = excluded.laxnumbers_team_id,
      ranking = excluded.ranking,
      rating = excluded.rating,
      agd = excluded.agd,
      sched = excluded.sched,
      wins = excluded.wins,
      losses = excluded.losses,
      ties = excluded.ties,
      gf = excluded.gf,
      ga = excluded.ga,
      captured_at = excluded.captured_at
  `);

  const updateTeamLnId = db.prepare(`
    UPDATE teams SET laxnumbers_team_id = ? WHERE id = ? AND (laxnumbers_team_id IS NULL OR laxnumbers_team_id != ?)
  `);

  for (const view of views) {
    let ratings: LaxRawRating[];
    try {
      ratings = await fetchRatings(year, view.id, fetchFn);
    } catch (err) {
      result.anomalies.push({
        kind: 'fetch_error',
        detail: `Failed to fetch view ${view.id} (${view.label}): ${(err as Error).message}`,
      });
      continue;
    }

    result.fetched += ratings.length;

    // Wrap all writes for this view in a single transaction so a partial run
    // cannot leave mixed-season data in laxnumbers_ratings.
    const writeView = db.transaction(() => {
      for (const r of ratings) {
        // Resolve LaxNumbers team name to our DB team
        const team = findTeamByName(db, r.name);
        if (!team) {
          result.unresolved++;
          result.anomalies.push({
            kind: 'unresolved_team',
            detail: `${r.name} (laxnumbers_id=${r.team_nbr}, view=${view.label})`,
          });
          continue;
        }

        result.resolved++;

        if (apply) {
          // Upsert the rating
          upsertRating.run(
            team.id,
            r.team_nbr,
            view.id,
            year,
            r.ranking,
            r.rating,
            r.agd,
            r.sched,
            r.wins,
            r.losses,
            r.ties,
            r.gf,
            r.ga,
          );
          result.upserted++;

          // Map the LaxNumbers team_id on our teams table
          const changes = updateTeamLnId.run(r.team_nbr, team.id, r.team_nbr);
          if (changes.changes > 0) result.teamIdsMapped++;
        }
      }
    });

    writeView();

    // Rate limit between views
    if (views.indexOf(view) < views.length - 1) {
      await sleep(1000);
    }
  }

  return result;
}
