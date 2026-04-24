// Tests for the centralized logger module.
//
// We don't try to assert wire-level pino output here — that would tie the
// suite to pino internals. Instead we cover the contract surface that
// callers depend on:
//   - createLogger returns a usable logger with the standard methods.
//   - The configured `level` and `name` are preserved.
//   - LOG_LEVEL env var is honored when no explicit level is supplied.
//   - Invalid LOG_LEVEL values silently fall back to 'info'.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.js';

describe('createLogger', () => {
  const origEnv = process.env.LOG_LEVEL;

  beforeEach(() => {
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = origEnv;
  });

  it('returns a logger with the standard pino methods', () => {
    const log = createLogger({ name: 'test:basic', pretty: false });
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.fatal).toBe('function');
    expect(typeof log.trace).toBe('function');
    expect(typeof log.child).toBe('function');
  });

  it('preserves the supplied name on records', () => {
    const log = createLogger({ name: 'test:named', pretty: false });
    expect(log.bindings().name).toBe('test:named');
  });

  it('respects an explicit level', () => {
    const log = createLogger({ name: 'test:level', level: 'warn', pretty: false });
    expect(log.level).toBe('warn');
  });

  it('honors LOG_LEVEL env var when level is not passed', () => {
    process.env.LOG_LEVEL = 'debug';
    const log = createLogger({ name: 'test:env', pretty: false });
    expect(log.level).toBe('debug');
  });

  it('falls back to info when LOG_LEVEL is unrecognized', () => {
    process.env.LOG_LEVEL = 'nope';
    const log = createLogger({ name: 'test:bad-env', pretty: false });
    expect(log.level).toBe('info');
  });

  it('supports child loggers with bound fields', () => {
    const parent = createLogger({ name: 'test:parent', pretty: false });
    const child = parent.child({ runId: 'abc' });
    expect(child.bindings().runId).toBe('abc');
    expect(child.bindings().name).toBe('test:parent');
  });
});
