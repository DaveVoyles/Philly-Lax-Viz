// W H4 L2 (Yoda) — search endpoint tests.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb } from '@pll/ingest/src/db.js';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../../app.js';

let db: Database;
let app: FastifyInstance;

interface Hit {
  kind: 'player' | 'team';
  id: number;
  name: string;
  teamName?: string;
}

beforeAll(async () => {
  db = openDb(':memory:');
  db.prepare('INSERT INTO teams (id, name, slug, division) VALUES (1, ?, ?, ?)')
    .run('Garnet Valley', 'garnet-valley', 'high-school');
  db.prepare('INSERT INTO teams (id, name, slug, division) VALUES (2, ?, ?, ?)')
    .run('Haverford', 'haverford', 'high-school');
  db.prepare('INSERT INTO teams (id, name, slug, division) VALUES (3, ?, ?, ?)')
    .run('Springfield Garnet', 'springfield-garnet', 'high-school');

  const insP = db.prepare(
    `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
     VALUES (?, ?, ?, ?, 'full')`,
  );
  insP.run(10, 'Garrett Smith', 'garrett smith', 2);
  insP.run(11, 'Quinn Garner', 'quinn garner', 1);
  insP.run(12, 'Jane Doe', 'jane doe', 1);

  app = await buildApp(db);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  db.close();
});

describe('GET /api/search', () => {
  it('returns empty when q is shorter than 2 characters', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=g' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('ranks exact prefix matches above contains-only matches', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=garn' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Hit[];
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]?.name).toBe('Garnet Valley');
    expect(body[0]?.kind).toBe('team');
    const names = body.map((h) => h.name);
    const garnetIdx = names.indexOf('Garnet Valley');
    const springfieldIdx = names.indexOf('Springfield Garnet');
    const quinnIdx = names.indexOf('Quinn Garner');
    expect(garnetIdx).toBeLessThan(springfieldIdx);
    expect(garnetIdx).toBeLessThan(quinnIdx);
  });

  it('returns mixed kinds (players + teams) with teamName on player hits', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=gar&limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Hit[];
    const kinds = new Set(body.map((h) => h.kind));
    expect(kinds.has('team')).toBe(true);
    expect(kinds.has('player')).toBe(true);
    const player = body.find((h) => h.kind === 'player' && h.name === 'Garrett Smith');
    expect(player).toBeDefined();
    expect(player?.teamName).toBe('Haverford');
  });
});
