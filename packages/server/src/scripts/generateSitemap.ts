import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const DB_PATH = path.join(REPO_ROOT, 'data', 'lacrosse.db');
const OUTPUT_PATH = path.join(REPO_ROOT, 'packages', 'web', 'public', 'sitemap.xml');
const SITE_ORIGIN = 'https://phillylaxstats.com';
const ROUTING_NOTE =
  'Hash-router URLs are included for now. Search engines can still render JS, but this sitemap will work better if the site migrates to history-based routing later.';
const ESCAPED_FRAGMENT_NOTE =
  'Legacy _escaped_fragment_ hint: a non-JS crawl fallback would need server support, e.g. https://phillylaxstats.com/?_escaped_fragment_=/teams/123';

type SitemapRow = {
  id: number;
  lastmod: string | null;
};

type SitemapEntry = {
  loc: string;
  priority: string;
  lastmod?: string | null;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value.slice(0, 10);
}

function entryXml(entry: SitemapEntry): string {
  const lines = ['  <url>', `    <loc>${escapeXml(entry.loc)}</loc>`];
  const lastmod = normalizeDate(entry.lastmod);
  if (lastmod) lines.push(`    <lastmod>${escapeXml(lastmod)}</lastmod>`);
  lines.push(`    <priority>${entry.priority}</priority>`, '  </url>');
  return lines.join('\n');
}

export function generateSitemap(options: { dbPath?: string; outputPath?: string } = {}): string {
  const db = new Database(options.dbPath ?? DB_PATH, { readonly: true });
  try {
    const latestGameDate =
      (db.prepare('SELECT MAX(date) AS lastmod FROM games').get() as { lastmod: string | null } | undefined)
        ?.lastmod ?? null;

    const teamRows = db
      .prepare(
        `SELECT t.id AS id, MAX(g.date) AS lastmod
         FROM teams t
         LEFT JOIN games g ON g.home_team_id = t.id OR g.away_team_id = t.id
         GROUP BY t.id
         ORDER BY t.id ASC`,
      )
      .all() as SitemapRow[];

    const playerRows = db
      .prepare(
        `SELECT p.id AS id, MAX(g.date) AS lastmod
         FROM players p
         LEFT JOIN player_stats ps ON ps.player_id = p.id
         LEFT JOIN games g ON g.id = ps.game_id
         GROUP BY p.id
         ORDER BY p.id ASC`,
      )
      .all() as SitemapRow[];

    const gameRows = db
      .prepare('SELECT id, date AS lastmod FROM games ORDER BY id ASC')
      .all() as SitemapRow[];

    const entries: SitemapEntry[] = [
      { loc: `${SITE_ORIGIN}/`, priority: '1.0', lastmod: latestGameDate },
      { loc: `${SITE_ORIGIN}/#/leaders`, priority: '0.5', lastmod: latestGameDate },
      { loc: `${SITE_ORIGIN}/#/top-teams`, priority: '0.5', lastmod: latestGameDate },
      { loc: `${SITE_ORIGIN}/#/schedule`, priority: '0.5', lastmod: latestGameDate },
      { loc: `${SITE_ORIGIN}/#/compare/players`, priority: '0.5', lastmod: latestGameDate },
      ...teamRows.map((row) => ({
        loc: `${SITE_ORIGIN}/#/teams/${row.id}`,
        priority: '0.8',
        lastmod: row.lastmod,
      })),
      ...playerRows.map((row) => ({
        loc: `${SITE_ORIGIN}/#/players/${row.id}`,
        priority: '0.7',
        lastmod: row.lastmod,
      })),
      ...gameRows.map((row) => ({
        loc: `${SITE_ORIGIN}/#/games/${row.id}`,
        priority: '0.6',
        lastmod: row.lastmod,
      })),
    ];

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<!-- ${ROUTING_NOTE} -->`,
      `<!-- ${ESCAPED_FRAGMENT_NOTE} -->`,
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...entries.map(entryXml),
      '</urlset>',
      '',
    ].join('\n');

    const outputPath = options.outputPath ?? OUTPUT_PATH;
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, xml, 'utf8');
    console.log(`[sitemap] wrote ${entries.length} urls to ${outputPath}`);
    return outputPath;
  } finally {
    db.close();
  }
}

function main(): void {
  generateSitemap();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
