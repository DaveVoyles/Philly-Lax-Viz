// One-shot script: fetch the PIAA D1 boys lacrosse rankings and replace the
// `piaa_official_teams` table contents (per-classification refresh).
//
// Run: `pnpm --filter @pll/ingest exec tsx src/scripts/syncPiaa.ts`

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDb } from '../db.js';
import { fetchPiaaTeams, type PiaaTeamRow } from '../sources/piaa.js';

import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:syncPiaa' });
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DB_PATH = process.env.DB_PATH ?? process.env.PLL_DB_PATH ?? path.join(REPO_ROOT, 'data', 'lacrosse.db');

async function main(): Promise<void> {
  const db = openDb(DB_PATH);
  log.info(`[syncPiaa] db=${DB_PATH}`);
  const rows = await fetchPiaaTeams();
  if (rows.length === 0) {
    log.error('[syncPiaa] no rows parsed — aborting (would otherwise wipe table)');
    process.exitCode = 1;
    db.close();
    return;
  }

  const fetchedAt = new Date().toISOString();
  const byClass = new Map<string, PiaaTeamRow[]>();
  for (const r of rows) {
    const arr = byClass.get(r.classification) ?? [];
    arr.push(r);
    byClass.set(r.classification, arr);
  }

  const del = db.prepare('DELETE FROM piaa_official_teams WHERE classification = ?');
  const ins = db.prepare(
    `INSERT INTO piaa_official_teams
       (name_official, name_normalized, classification, seed, wins, losses, ties, total_points, ranking, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    for (const [classification, items] of byClass) {
      del.run(classification);
      for (const r of items) {
        ins.run(
          r.nameOfficial,
          r.nameNormalized,
          r.classification,
          r.seed,
          r.wins,
          r.losses,
          r.ties,
          r.totalPoints,
          r.ranking,
          fetchedAt,
        );
      }
    }
  });
  tx();

  log.info(`[syncPiaa] inserted ${rows.length} rows at ${fetchedAt}`);
  for (const [classification, items] of byClass) {
    log.info(`  ${classification}: ${items.length} teams`);
  }
  db.close();
}

main().catch((err) => {
  log.error('[syncPiaa] failed:', err);
  process.exit(1);
});
