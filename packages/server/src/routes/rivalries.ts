// GET /api/rivalries — node + edge dataset for the WebGL rivalry graph.
// W12 L2 (Han). No query params (yet); whole-league snapshot.

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getRivalryGraph } from '../queries/rivalries.js';

export async function rivalriesRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get('/api/rivalries', async () => getRivalryGraph(db));
}
