// db.ts — better-sqlite3 connection + migration runner.
// Usage: const db = openDb('data/lacrosse.db'); — applies any pending migrations
// idempotently using PRAGMA user_version as the version cursor.

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Load `NNN_*.sql` migrations from the migrations directory, sorted ascending. */
export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((file) => {
    const match = /^(\d+)_/.exec(file);
    if (!match) {
      throw new Error(`Migration filename must start with NNN_: ${file}`);
    }
    return {
      version: Number(match[1]),
      name: file,
      sql: readFileSync(join(dir, file), 'utf8'),
    };
  });
}

/** Apply any migrations whose version > current PRAGMA user_version. Idempotent. */
export function runMigrations(db: DatabaseType, migrations: Migration[] = loadMigrations()): number {
  const current = db.pragma('user_version', { simple: true }) as number;
  let applied = 0;
  for (const m of migrations) {
    if (m.version <= current) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      // user_version PRAGMA does not accept bound parameters.
      db.pragma(`user_version = ${m.version}`);
    });
    tx();
    applied += 1;
  }
  return applied;
}

/**
 * Open a SQLite DB at `path` (creating parent dirs if needed) and apply migrations.
 * Returns a ready-to-use better-sqlite3 Database with foreign keys enabled.
 */
export function openDb(path: string): DatabaseType {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  const journalMode = process.env.DB_JOURNAL_MODE ?? 'WAL';
  db.pragma(`journal_mode = ${journalMode}`);
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export type { DatabaseType as Database };
