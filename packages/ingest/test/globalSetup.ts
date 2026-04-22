// vitest globalSetup — wipes + reseeds data/lacrosse.test.db once per test
// run, then exports DB_PATH/PLL_DB_PATH so any code that consults env picks
// up the test DB instead of the live data/lacrosse.db.
//
// Tests that use `:memory:` directly are unaffected (preferred for isolation).
// This setup exists so that anything which *does* fall through to env still
// lands on a disposable file, never the live DB.

import { seedTestDb, DEFAULT_TEST_DB_PATH } from '../src/scripts/seedTestDb.js';

export default function setup(): void {
  const path = seedTestDb(DEFAULT_TEST_DB_PATH);
  process.env.DB_PATH = path;
  process.env.PLL_DB_PATH = path;
}
