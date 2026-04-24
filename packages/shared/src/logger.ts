// Centralized structured logger for the monorepo.
//
// All ingest scripts, CLI entrypoints, and the server import `createLogger`
// from `@pll/shared` so log output goes through one configurable pipeline.
// See docs/improvements/07-centralized-logger-rollout.md.
//
// Behavior:
// - Level defaults to env LOG_LEVEL (lowercased), then 'info'.
// - When stdout is a TTY (interactive dev), pino-pretty is used for
//   human-readable colorized output. Otherwise raw JSON is emitted so
//   container/CI runs are machine-parseable.
// - Each call site supplies a `name` (e.g. 'ingest:dedupPlayers') so log
//   lines can be filtered by origin.

import pino, { type Logger, type LoggerOptions, type Level } from 'pino';

export type { Logger };

export interface CreateLoggerOpts {
  /** Logger name; appears in every record under the `name` field. */
  name: string;
  /** Override the level. Defaults to env LOG_LEVEL or 'info'. */
  level?: Level;
  /** Force pretty / JSON. Defaults to whether stdout is a TTY. */
  pretty?: boolean;
}

const VALID_LEVELS: ReadonlySet<string> = new Set([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);

function resolveLevel(explicit: Level | undefined): Level {
  if (explicit) return explicit;
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env && VALID_LEVELS.has(env)) return env as Level;
  return 'info';
}

export function createLogger(opts: CreateLoggerOpts): Logger {
  const level = resolveLevel(opts.level);
  const pretty = opts.pretty ?? Boolean(process.stdout.isTTY);

  const config: LoggerOptions = { name: opts.name, level };
  if (pretty) {
    config.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
    };
  }
  return pino(config);
}
