#!/usr/bin/env tsx
// syncLaxNumbersRatings.ts — Fetch LaxNumbers team ratings and store in DB.
//
// Usage:
//   pnpm --filter @pll/ingest exec tsx src/scripts/syncLaxNumbersRatings.ts
//   pnpm --filter @pll/ingest exec tsx src/scripts/syncLaxNumbersRatings.ts --year=2026 --apply
//   pnpm --filter @pll/ingest exec tsx src/scripts/syncLaxNumbersRatings.ts --view=3454 --apply
//
// Options:
//   --year=YYYY    Year to fetch (default: current year)
//   --view=ID      Single view ID to fetch (default: all configured views)
//   --apply        Write to DB (default: dry-run)
//   --db=PATH      DB path (default: data/lacrosse.db)

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db.js';
import { runLaxNumbersRatings, DEFAULT_VIEWS } from '../pipelines/laxnumbersRatings.js';

const __here = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  let year = new Date().getFullYear();
  let viewId: number | undefined;
  let apply = false;
  let dbPath = resolve(__here, '..', '..', '..', '..', 'data', 'lacrosse.db');

  for (const arg of args) {
    if (arg.startsWith('--year=')) year = parseInt(arg.slice(7), 10);
    else if (arg.startsWith('--view=')) viewId = parseInt(arg.slice(7), 10);
    else if (arg === '--apply') apply = true;
    else if (arg.startsWith('--db=')) dbPath = resolve(arg.slice(5));
  }

  return { year, viewId, apply, dbPath };
}

async function main() {
  const { year, viewId, apply, dbPath } = parseArgs();

  console.log(`[syncLaxNumbersRatings] year=${year} apply=${apply} db=${dbPath}`);

  const views = viewId
    ? [{ id: viewId, label: `view-${viewId}` }]
    : DEFAULT_VIEWS;

  console.log(`[syncLaxNumbersRatings] Views: ${views.map((v) => `${v.label} (${v.id})`).join(', ')}`);

  const db = openDb(dbPath);

  const result = await runLaxNumbersRatings(db, { year, views, apply });

  console.log(`\n--- Results ---`);
  console.log(`  Fetched:       ${result.fetched} teams across ${views.length} view(s)`);
  console.log(`  Resolved:      ${result.resolved}`);
  console.log(`  Unresolved:    ${result.unresolved}`);
  console.log(`  Upserted:      ${result.upserted}`);
  console.log(`  Team IDs set:  ${result.teamIdsMapped}`);

  if (result.anomalies.length > 0) {
    console.log(`\n--- Anomalies (${result.anomalies.length}) ---`);
    for (const a of result.anomalies) {
      console.log(`  [${a.kind}] ${a.detail}`);
    }
  }

  if (!apply) {
    console.log(`\n(dry-run) Pass --apply to write to DB.`);
  } else {
    console.log('\n\u26a0\ufe0f  Remember: run `pnpm db:upload` to push these changes to the Azure-hosted DB.');
  }

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
