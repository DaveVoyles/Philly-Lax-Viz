// piaaSchedule.ts — fetch the PIAA D1 boys lacrosse "Export Full Schedule"
// CSV and cache it locally so re-runs don't re-fetch. Polite scrape:
// single request per season, 1s minimum spacing if multiple seasons are
// pulled in one process.

import * as fs from 'node:fs';
import * as path from 'node:path';

const PIAA_BASE = 'https://www.piaad1.org';
const SCHEDULE_PATH =
  '/sports/spring-sports/lacrosse-b/scores-and-rankings/export';
const USER_AGENT = 'Mozilla/5.0 PhillyLaxBot/1.0 (+schedule-ingest)';
const MIN_SPACING_MS = 1000;

let lastFetchAt = 0;

export interface FetchScheduleOpts {
  season: number;
  cacheDir: string;
  /** When true, ignore an existing cache file and re-fetch. */
  force?: boolean;
}

export interface FetchScheduleResult {
  csv: string;
  source: 'cache' | 'network';
  cachePath: string;
  url: string;
}

export async function fetchPiaaScheduleCsv(
  opts: FetchScheduleOpts,
): Promise<FetchScheduleResult> {
  const url = `${PIAA_BASE}${SCHEDULE_PATH}?type=games&year=${opts.season}&sport=BoysLacrosse`;
  fs.mkdirSync(opts.cacheDir, { recursive: true });
  const cachePath = path.join(opts.cacheDir, `piaa-d1-${opts.season}.csv`);

  if (!opts.force && fs.existsSync(cachePath)) {
    const csv = fs.readFileSync(cachePath, 'utf8');
    return { csv, source: 'cache', cachePath, url };
  }

  // Rate-limit: keep at least MIN_SPACING_MS between live fetches.
  const elapsed = Date.now() - lastFetchAt;
  if (elapsed < MIN_SPACING_MS) {
    await new Promise((r) => setTimeout(r, MIN_SPACING_MS - elapsed));
  }
  lastFetchAt = Date.now();

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(
      `PIAA schedule fetch failed: HTTP ${res.status} ${res.statusText} for ${url}`,
    );
  }
  const csv = await res.text();
  fs.writeFileSync(cachePath, csv, 'utf8');
  return { csv, source: 'network', cachePath, url };
}
