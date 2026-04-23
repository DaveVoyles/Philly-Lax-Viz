// postImages.test.ts -- Wave 17 Lane 2 (Han). Server tests for image join +
// batch lookup endpoint.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb } from '@pll/ingest/src/db.js';
import { buildApp } from '../app.js';

let app: FastifyInstance;
let db: ReturnType<typeof openDb>;

beforeAll(async () => {
  db = openDb(':memory:');
  // Minimal seed: a team, a game, an image.
  db.exec(`
    INSERT INTO teams (id, name, slug, division) VALUES (1, 'Harriton', 'harriton', 'Aces');
    INSERT INTO teams (id, name, slug, division) VALUES (2, 'Lower Merion', 'lower-merion', 'Aces');
    INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score,
      ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
      VALUES (100, '2025-04-04', 1, 2, 12, 7, 0, 0, 'recap-slug-100', 'https://x', '2025-04-04T00:00:00Z', 2025);
    INSERT INTO post_images (post_slug, image_url, alt_text, width, height)
      VALUES ('recap-slug-100', 'https://cdn.example.com/recap.jpg', 'recap', 600, 400);
    INSERT INTO post_images (post_slug, image_url, alt_text, width, height)
      VALUES ('commit-slug-200', 'https://cdn.example.com/player.jpg', 'player', 300, 300);
  `);
  app = await buildApp(db);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  db.close();
});

describe('Wave 17 image surfaces', () => {
  it('GET /api/games/:id includes imageUrl from post_images join', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games/100' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { game: { imageUrl: string | null } };
    expect(body.game.imageUrl).toBe('https://cdn.example.com/recap.jpg');
  });

  it('GET /api/posts/images?slugs= returns batch map', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/posts/images?slugs=recap-slug-100,commit-slug-200,does-not-exist',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      images: Record<string, { imageUrl: string; width: number | null; height: number | null }>;
    };
    expect(body.images['recap-slug-100']!.imageUrl).toBe('https://cdn.example.com/recap.jpg');
    expect(body.images['commit-slug-200']!.imageUrl).toBe('https://cdn.example.com/player.jpg');
    expect(body.images['does-not-exist']).toBeUndefined();
  });

  it('GET /api/posts/images with empty slugs returns empty map', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/posts/images?slugs=' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { images: Record<string, unknown> };
    expect(body.images).toEqual({});
  });
});
