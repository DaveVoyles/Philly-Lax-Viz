// vitest globalSetup — see packages/ingest/src/scripts/seedTestDb.ts for the
// rationale. Server tests primarily use `:memory:` DBs, but this setup
// guarantees that any code path consulting DB_PATH / PLL_DB_PATH lands on a
// disposable test file instead of the live data/lacrosse.db.

import { seedTestDb, DEFAULT_TEST_DB_PATH } from '@pll/ingest/src/scripts/seedTestDb.js';

export default function setup(): void {
  const path = seedTestDb(DEFAULT_TEST_DB_PATH);
  process.env.DB_PATH = path;
  process.env.PLL_DB_PATH = path;
}
