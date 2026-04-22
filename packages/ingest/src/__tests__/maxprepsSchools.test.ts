import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import {
  parseMaxprepsSchoolsHtml,
  maxprepsSlugFromHref,
  type MaxprepsSchool,
} from '../sources/maxprepsSchools.js';
import { downloadLogo } from '../sources/logoDownload.js';
import { openDb } from '../db.js';
import { normalizeTeamName as normalizeForMatch } from '../normalize/teamName.js';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const SNAPSHOT = path.join(REPO_ROOT, 'fixtures', 'maxpreps-pa-schools.snapshot.html');
const REAL_DB = path.join(REPO_ROOT, 'data', 'lacrosse.db');

function matchKey(s: string): string {
  let n: string;
  try {
    n = normalizeForMatch(s);
  } catch {
    n = s;
  }
  return n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

describe('maxprepsSchools — pure helpers', () => {
  it('maxprepsSlugFromHref extracts city/school segment', () => {
    expect(maxprepsSlugFromHref('/pa/abington/abington-galloping-ghosts/lacrosse/')).toBe(
      'abington/abington-galloping-ghosts',
    );
    expect(maxprepsSlugFromHref('/pa/clarks-summit/abington-heights-comets/lacrosse')).toBe(
      'clarks-summit/abington-heights-comets',
    );
    expect(maxprepsSlugFromHref('/pa/lacrosse/schools/')).toBe('');
    expect(maxprepsSlugFromHref('/nj/foo/bar/lacrosse/')).toBe('');
  });
});

describe('maxprepsSchools — parseMaxprepsSchoolsHtml', () => {
  if (!fs.existsSync(SNAPSHOT)) {
    it.skip('snapshot fixture not found at ' + SNAPSHOT, () => undefined);
    return;
  }
  const html = fs.readFileSync(SNAPSHOT, 'utf8');
  let schools: MaxprepsSchool[] = [];
  beforeAll(() => {
    schools = parseMaxprepsSchoolsHtml(html);
  });

  it('parses at least 10 schools with logoUrl populated', () => {
    expect(schools.length).toBeGreaterThanOrEqual(10);
    const withLogos = schools.filter((s) => s.logoUrl);
    expect(withLogos.length).toBeGreaterThanOrEqual(10);
  });

  it('every school has name + non-empty maxprepsSlug + state PA when present', () => {
    for (const s of schools) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.maxprepsSlug.length).toBeGreaterThan(0);
      expect(s.maxprepsSlug).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
      if (s.state) expect(s.state).toBe('PA');
    }
  });

  it('Abington is parsed with the expected slug', () => {
    const abington = schools.find((s) => s.name === 'Abington');
    expect(abington).toBeDefined();
    expect(abington?.maxprepsSlug).toBe('abington/abington-galloping-ghosts');
    expect(abington?.city).toBe('Abington');
    expect(abington?.state).toBe('PA');
    expect(abington?.logoUrl).toContain('image.maxpreps.io/school-mascot/');
  });

  it('handles a synthetic team with no img gracefully', () => {
    const noLogoHtml = `
      <html><body>
        <a title="Mystery Team" href="/pa/mystery-town/mystery-team-mythics/lacrosse/">
          <div>
            <div class="title">Mystery Team</div>
            <div class="description">Mystery Town, PA</div>
          </div>
        </a>
      </body></html>
    `;
    const rows = parseMaxprepsSchoolsHtml(noLogoHtml);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Mystery Team');
    expect(rows[0]?.logoUrl).toBeNull();
    expect(rows[0]?.maxprepsSlug).toBe('mystery-town/mystery-team-mythics');
  });

  it('does not return duplicate slugs', () => {
    const slugs = schools.map((s) => s.maxprepsSlug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  // Match-rate test against the live DB. Opt-in via PLL_LIVE_DB_TEST=1 to
  // avoid test runs touching data/lacrosse.db. The seeded test DB
  // (data/lacrosse.test.db, ~5 teams) intentionally won't match this gate.
  if (process.env.PLL_LIVE_DB_TEST === '1' && fs.existsSync(REAL_DB)) {
    it('matches ≥55% of MaxPreps schools against current teams DB (strict only)', () => {
      const db = openDb(REAL_DB);
      const teams = db
        .prepare('SELECT id, name, slug FROM teams')
        .all() as Array<{ id: number; name: string; slug: string }>;
      const byName = new Map<string, number>();
      const bySlug = new Map<string, number>();
      for (const t of teams) {
        byName.set(matchKey(t.name), t.id);
        bySlug.set(matchKey(t.slug), t.id);
      }
      const matchedTeamIds = new Set<number>();
      for (const s of schools) {
        const k = matchKey(s.name);
        const id = byName.get(k) ?? bySlug.get(k);
        if (id) matchedTeamIds.add(id);
      }
      const rate = matchedTeamIds.size / teams.length;
      // Strict-exact match floor. The real coverage target (≥80%) is hit via
      // syncLogos.ts which adds suffix-stripped fallback matching + manual
      // overrides from data/team-overrides.json. Verified post-sync via:
      //   sqlite3 data/lacrosse.db "SELECT COUNT(*) FROM teams WHERE logo_url IS NOT NULL"
      expect(rate).toBeGreaterThanOrEqual(0.55);
      db.close();
    });
  } else {
    it.skip('live DB match-rate test — set PLL_LIVE_DB_TEST=1 to enable', () => undefined);
  }
});

describe('syncLogos — idempotent re-run produces zero new file writes', () => {
  // Standalone unit test of the file-skip behavior: when a destination file
  // exists with the same byte length the remote reports via Content-Length,
  // we must not overwrite it.
  let tmpDir: string;
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, 'data', '.test-logos-'));
  });
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips re-download when local file size matches remote Content-Length', async () => {
    const dest = path.join(tmpDir, 'fake-team.gif');
    const payload = Buffer.from('GIF89a-fake-bytes');
    fs.writeFileSync(dest, payload);

    const calls: Array<{ url: string; method: string }> = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url: u, method });
      if (method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'content-length': String(payload.length) },
        });
      }
      return new Response(payload, {
        status: 200,
        headers: { 'content-length': String(payload.length) },
      });
    }) as typeof fetch;

    try {
      const before = fs.statSync(dest).mtimeMs;
      const out = await downloadLogo('https://example.com/fake.gif', dest);
      const after = fs.statSync(dest).mtimeMs;
      expect(out.written).toBe(false);
      expect(after).toBe(before);
      expect(calls.filter((c) => c.method === 'GET')).toHaveLength(0);
      expect(calls.filter((c) => c.method === 'HEAD')).toHaveLength(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
