// Wave 3 Lane 2: verify logoUrl is exposed on team-bearing endpoints,
// and that /logos/<file> serves the static file with correct content-type.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { openDb } from '@pll/ingest/src/db.js';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../app.js';

let db: Database;
let app: FastifyInstance;
let logosDir: string;

const NOW = '2025-04-21T12:00:00Z';
const PARSER = '0.1.0';

// 1x1 transparent GIF (smallest valid GIF)
const GIF_BYTES = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

function seed(d: Database): void {
  d.prepare(
    "INSERT INTO teams (id, name, slug, division, logo_url, maxpreps_slug) VALUES (1, 'Abington', 'abington', 'high-school', 'abington.gif', 'abington')",
  ).run();
  d.prepare(
    "INSERT INTO teams (id, name, slug, division, logo_url, maxpreps_slug) VALUES (2, 'Episcopal', 'episcopal', 'high-school', NULL, NULL)",
  ).run();
  d.prepare(
    "INSERT INTO teams (id, name, slug, division, logo_url, maxpreps_slug) VALUES (3, 'Malvern Prep', 'malvern-prep', 'high-school', 'malvern-prep.gif', 'malvern-prep')",
  ).run();

  // Need at least one game per team so /api/leaders/teams returns them.
  const games: Array<[number, string, number, number, number, number]> = [
    [10, '2025-04-21', 1, 2, 12, 8],
    [11, '2025-04-19', 3, 1, 9, 11],
    [12, '2025-04-15', 2, 3, 10, 6],
  ];
  for (const [id, date, h, a, hs, as_] of games) {
    d.prepare(
      `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, NULL, ?)`,
    ).run(id, date, h, a, hs, as_, `post-${id}`, NOW);
  }
  // touch parser version constant so lint doesn't complain
  void PARSER;
}

beforeAll(async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const baseDir = path.join(here, '.tmp');
  mkdirSync(baseDir, { recursive: true });
  logosDir = mkdtempSync(path.join(baseDir, 'logos-'));
  writeFileSync(path.join(logosDir, 'abington.gif'), GIF_BYTES);
  writeFileSync(path.join(logosDir, 'malvern-prep.gif'), GIF_BYTES);

  db = openDb(':memory:');
  seed(db);
  app = await buildApp(db, { logosDir });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  db.close();
  rmSync(logosDir, { recursive: true, force: true });
});

describe('GET /api/teams — logoUrl', () => {
  it('returns /logos/<file>.gif for a known-good team and null for a known-null team', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: number; name: string; logoUrl: string | null }>;
    const abington = body.find((t) => t.id === 1);
    const episcopal = body.find((t) => t.id === 2);
    expect(abington?.logoUrl).toBe('/logos/abington.gif');
    expect(episcopal?.logoUrl).toBeNull();
  });
});

describe('GET /api/teams/:id — logoUrl', () => {
  it('exposes logoUrl on the team object', async () => {
    const withLogo = await app.inject({ method: 'GET', url: '/api/teams/1' });
    expect(withLogo.statusCode).toBe(200);
    expect(withLogo.json().team.logoUrl).toBe('/logos/abington.gif');

    const withoutLogo = await app.inject({ method: 'GET', url: '/api/teams/2' });
    expect(withoutLogo.statusCode).toBe(200);
    expect(withoutLogo.json().team.logoUrl).toBeNull();
  });
});

describe('GET /api/games/:id — logoUrl', () => {
  it('exposes logoUrl on homeTeam and awayTeam', async () => {
    // Game 10: home=Abington (logo), away=Episcopal (null)
    const res = await app.inject({ method: 'GET', url: '/api/games/10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.homeTeam.id).toBe(1);
    expect(body.homeTeam.logoUrl).toBe('/logos/abington.gif');
    expect(body.awayTeam.id).toBe(2);
    expect(body.awayTeam.logoUrl).toBeNull();
  });
});

describe('GET /api/leaders/teams — logoUrl', () => {
  it('exposes logoUrl on every team row', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leaders/teams?metric=wins' });
    expect(res.statusCode).toBe(200);
    const rows = res.json().rows as Array<{ teamId: number; logoUrl: string | null }>;
    const abington = rows.find((r) => r.teamId === 1);
    const episcopal = rows.find((r) => r.teamId === 2);
    expect(abington?.logoUrl).toBe('/logos/abington.gif');
    expect(episcopal?.logoUrl).toBeNull();
  });
});

describe('GET /logos/<file>.gif — static serving', () => {
  it('serves a real GIF with image/gif content-type', async () => {
    const res = await app.inject({ method: 'GET', url: '/logos/abington.gif' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/gif/);
    // GIF89a / GIF87a magic bytes
    expect(res.rawPayload.slice(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/);
  });

  it('404s on a missing logo (Leia handles fallback in web)', async () => {
    const res = await app.inject({ method: 'GET', url: '/logos/does-not-exist.gif' });
    expect(res.statusCode).toBe(404);
  });
});
