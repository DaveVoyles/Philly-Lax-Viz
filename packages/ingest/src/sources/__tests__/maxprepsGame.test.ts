import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  fetchMaxprepsGameScore,
  parseMaxprepsGameHtml,
  mapParsedScores,
  maxprepsDatePath,
  slugifyTeamName,
  teamUrlSlugCandidates,
  buildGameUrlCandidates,
} from '../maxprepsGame.js';
import type { MaxprepsSchool } from '../maxprepsSchools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(
  __dirname,
  '../../../../../fixtures/maxpreps/pottsgrove-vs-spring-ford-2026-04-16.html',
);
const fixtureHtml = readFileSync(fixturePath, 'utf8');

describe('maxprepsDatePath', () => {
  it('converts ISO date to MM-DD-YYYY', () => {
    expect(maxprepsDatePath('2026-04-16')).toBe('04-16-2026');
    expect(maxprepsDatePath('2026-01-01')).toBe('01-01-2026');
  });
  it('returns empty on invalid input', () => {
    expect(maxprepsDatePath('4-16-2026')).toBe('');
    expect(maxprepsDatePath('not-a-date')).toBe('');
  });
});

describe('slugifyTeamName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyTeamName('Spring-Ford')).toBe('spring-ford');
    expect(slugifyTeamName('Pope John Paul II')).toBe('pope-john-paul-ii');
    expect(slugifyTeamName('Conwell-Egan Catholic')).toBe('conwell-egan-catholic');
  });
});

describe('teamUrlSlugCandidates', () => {
  const schools: MaxprepsSchool[] = [
    {
      name: 'Spring-Ford',
      city: 'Royersford',
      state: 'PA',
      logoUrl: null,
      maxprepsSlug: 'royersford/spring-ford-rams',
    },
  ];

  it('falls back to slugify when no schools provided', () => {
    expect(teamUrlSlugCandidates('Spring-Ford')).toEqual(['spring-ford']);
  });

  it('uses school maxprepsSlug team segment when matched', () => {
    const cands = teamUrlSlugCandidates('Spring-Ford', schools);
    expect(cands).toContain('spring-ford-rams');
    expect(cands).toContain('spring-ford'); // mascot stripped
    expect(cands).toContain('royersford'); // city
  });

  it('falls back to slugify when school name does not match', () => {
    const cands = teamUrlSlugCandidates('Pottsgrove', schools);
    expect(cands).toEqual(['pottsgrove']);
  });
});

describe('buildGameUrlCandidates', () => {
  it('builds both home-vs-away and away-vs-home orderings', () => {
    const urls = buildGameUrlCandidates({
      homeName: 'Pottsgrove',
      awayName: 'Spring-Ford',
      dateISO: '2026-04-16',
    });
    expect(urls).toContain(
      'https://www.maxpreps.com/games/04-16-2026/lacrosse-26/spring-ford-vs-pottsgrove.htm',
    );
    expect(urls).toContain(
      'https://www.maxpreps.com/games/04-16-2026/lacrosse-26/pottsgrove-vs-spring-ford.htm',
    );
  });

  it('returns empty on bad date', () => {
    expect(
      buildGameUrlCandidates({
        homeName: 'A',
        awayName: 'B',
        dateISO: 'bogus',
      }),
    ).toEqual([]);
  });
});

describe('parseMaxprepsGameHtml (live fixture)', () => {
  it('extracts both team scores from the boxscore', () => {
    const rows = parseMaxprepsGameHtml(fixtureHtml);
    expect(rows).toHaveLength(2);
    const teams = rows.map((r) => r.team).sort();
    expect(teams).toEqual(['Pottsgrove', 'Spring-Ford']);
    const scoreFor = (name: string) =>
      rows.find((r) => r.team === name)?.score;
    expect(scoreFor('Spring-Ford')).toBe(15);
    expect(scoreFor('Pottsgrove')).toBe(5);
  });

  it('returns empty array on empty input', () => {
    expect(parseMaxprepsGameHtml('')).toEqual([]);
  });

  it('returns empty array on a 404 page', () => {
    const html = '<html><head><title>404 - Not Found</title></head></html>';
    expect(parseMaxprepsGameHtml(html)).toEqual([]);
  });

  it('returns empty array on a login wall', () => {
    const html =
      '<html><body><form id="login" action="/signin"></form></body></html>';
    expect(parseMaxprepsGameHtml(html)).toEqual([]);
  });

  it('returns empty array when no boxscore present', () => {
    const html = '<html><body><div>no scores here</div></body></html>';
    expect(parseMaxprepsGameHtml(html)).toEqual([]);
  });
});

describe('mapParsedScores', () => {
  it('maps rows to home/away by name match', () => {
    const rows = [
      { team: 'Spring-Ford', score: 15 },
      { team: 'Pottsgrove', score: 5 },
    ];
    expect(mapParsedScores(rows, 'Pottsgrove', 'Spring-Ford')).toEqual({
      homeScore: 5,
      awayScore: 15,
    });
    expect(mapParsedScores(rows, 'Spring-Ford', 'Pottsgrove')).toEqual({
      homeScore: 15,
      awayScore: 5,
    });
  });

  it('returns null on ambiguous match', () => {
    const rows = [
      { team: 'Spring-Ford', score: 15 },
      { team: 'Pottsgrove', score: 5 },
    ];
    expect(mapParsedScores(rows, 'Unknown', 'Other')).toBeNull();
  });

  it('returns null when row count != 2', () => {
    expect(mapParsedScores([], 'A', 'B')).toBeNull();
  });
});

describe('fetchMaxprepsGameScore — pre-loaded HTML path', () => {
  it('returns mapped scores from the fixture', async () => {
    const result = await fetchMaxprepsGameScore({
      homeName: 'Pottsgrove',
      awayName: 'Spring-Ford',
      dateISO: '2026-04-16',
      html: fixtureHtml,
    });
    expect(result).not.toBeNull();
    expect(result!.homeScore).toBe(5);
    expect(result!.awayScore).toBe(15);
    expect(result!.sourceUrl).toContain(
      '/games/04-16-2026/lacrosse-26/spring-ford-vs-pottsgrove.htm',
    );
  });

  it('returns null on empty HTML', async () => {
    const result = await fetchMaxprepsGameScore({
      homeName: 'A',
      awayName: 'B',
      dateISO: '2026-04-16',
      html: '',
    });
    expect(result).toBeNull();
  });

  it('returns null on login wall HTML', async () => {
    const html = '<html><body><form id="login"></form></body></html>';
    const result = await fetchMaxprepsGameScore({
      homeName: 'A',
      awayName: 'B',
      dateISO: '2026-04-16',
      html,
    });
    expect(result).toBeNull();
  });

  it('returns null when score elements are missing', async () => {
    const html = '<html><body><div>no boxscore</div></body></html>';
    const result = await fetchMaxprepsGameScore({
      homeName: 'A',
      awayName: 'B',
      dateISO: '2026-04-16',
      html,
    });
    expect(result).toBeNull();
  });
});

describe('fetchMaxprepsGameScore — network path (injected fetch)', () => {
  it('uses fetchImpl and sleepImpl, returns scores on success', async () => {
    const sleepImpl = vi.fn(async () => {});
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('pottsgrove-vs-spring-ford.htm')) {
        return new Response(fixtureHtml, { status: 200 });
      }
      return new Response('<title>404 - Not Found</title>', { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const result = await fetchMaxprepsGameScore({
      homeName: 'Pottsgrove',
      awayName: 'Spring-Ford',
      dateISO: '2026-04-16',
      fetchImpl,
      sleepImpl,
    });
    expect(result).not.toBeNull();
    expect(result!.homeScore).toBe(5);
    expect(result!.awayScore).toBe(15);
    expect(result!.sourceUrl).toContain('pottsgrove-vs-spring-ford.htm');
    expect(sleepImpl).toHaveBeenCalledWith(1500);
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('returns null when all candidate URLs 404', async () => {
    const sleepImpl = vi.fn(async () => {});
    const fetchImpl = vi.fn(
      async () => new Response('not found', { status: 404 }),
    ) as unknown as typeof globalThis.fetch;
    const result = await fetchMaxprepsGameScore({
      homeName: 'Nowhere',
      awayName: 'Imaginary',
      dateISO: '2026-04-16',
      fetchImpl,
      sleepImpl,
    });
    expect(result).toBeNull();
  });

  it('returns null on network error (no throw)', async () => {
    const sleepImpl = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof globalThis.fetch;
    const result = await fetchMaxprepsGameScore({
      homeName: 'A',
      awayName: 'B',
      dateISO: '2026-04-16',
      fetchImpl,
      sleepImpl,
    });
    expect(result).toBeNull();
  });

  it('uses schools index to construct candidate URLs', async () => {
    const sleepImpl = vi.fn(async () => {});
    const requestedUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      requestedUrls.push(String(url));
      return new Response('not found', { status: 404 });
    }) as unknown as typeof globalThis.fetch;
    const schools: MaxprepsSchool[] = [
      {
        name: 'Spring-Ford',
        city: 'Royersford',
        state: 'PA',
        logoUrl: null,
        maxprepsSlug: 'royersford/spring-ford-rams',
      },
    ];
    await fetchMaxprepsGameScore({
      homeName: 'Pottsgrove',
      awayName: 'Spring-Ford',
      dateISO: '2026-04-16',
      schools,
      fetchImpl,
      sleepImpl,
    });
    expect(
      requestedUrls.some((u) => u.includes('spring-ford-rams')),
    ).toBe(true);
    expect(
      requestedUrls.some((u) => u.includes('spring-ford-vs-pottsgrove.htm')),
    ).toBe(true);
  });

  it('passes Cookie header through when opts.cookie is set', async () => {
    const sleepImpl = vi.fn(async () => {});
    const seenHeaders: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const h = init?.headers as Record<string, string> | undefined;
      if (h) seenHeaders.push(h);
      return new Response('not found', { status: 404 });
    }) as unknown as typeof globalThis.fetch;
    await fetchMaxprepsGameScore({
      homeName: 'A',
      awayName: 'B',
      dateISO: '2026-04-16',
      cookie: 'session=abc123; foo=bar',
      fetchImpl,
      sleepImpl,
    });
    expect(seenHeaders.length).toBeGreaterThan(0);
    expect(seenHeaders[0]?.Cookie).toBe('session=abc123; foo=bar');
  });

  it('omits Cookie header when opts.cookie is undefined', async () => {
    const sleepImpl = vi.fn(async () => {});
    const seenHeaders: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const h = init?.headers as Record<string, string> | undefined;
      if (h) seenHeaders.push(h);
      return new Response('not found', { status: 404 });
    }) as unknown as typeof globalThis.fetch;
    await fetchMaxprepsGameScore({
      homeName: 'A',
      awayName: 'B',
      dateISO: '2026-04-16',
      fetchImpl,
      sleepImpl,
    });
    expect(seenHeaders.length).toBeGreaterThan(0);
    expect(seenHeaders[0]?.Cookie).toBeUndefined();
  });
});
