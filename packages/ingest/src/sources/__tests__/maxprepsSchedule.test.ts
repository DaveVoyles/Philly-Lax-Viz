import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildScheduleUrl,
  parseScheduleHtml,
  findScheduleEntry,
  fetchTeamSchedule,
} from '../maxprepsSchedule.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(
  resolve(__dirname, '../../../../../fixtures/maxpreps/spring-ford-schedule-2026.html'),
  'utf8',
);

describe('buildScheduleUrl', () => {
  it('builds a Spring-Ford schedule URL from slug', () => {
    expect(
      buildScheduleUrl({ schoolSlug: 'royersford/spring-ford-rams' }),
    ).toBe(
      'https://www.maxpreps.com/pa/royersford/spring-ford-rams/lacrosse/schedule/',
    );
  });

  it('uses lowercased state when provided', () => {
    expect(
      buildScheduleUrl({
        schoolSlug: 'foo/bar',
        state: 'NJ',
      }),
    ).toBe('https://www.maxpreps.com/nj/foo/bar/lacrosse/schedule/');
  });
});

describe('parseScheduleHtml', () => {
  it('returns [] for empty input', () => {
    expect(parseScheduleHtml('')).toEqual([]);
  });

  it('extracts 15 unique games from the Spring-Ford fixture and dedupes relative+absolute hrefs', () => {
    const entries = parseScheduleHtml(fixtureHtml);
    expect(entries.length).toBe(15);
    const urls = entries.map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
    // All URLs must be absolute
    for (const u of urls) {
      expect(u.startsWith('https://www.maxpreps.com/games/')).toBe(true);
    }
  });

  it('parses dateISO + slugs correctly for the Pottsgrove entry', () => {
    const entries = parseScheduleHtml(fixtureHtml);
    const pottsgrove = entries.find(
      (e) => e.firstSlug === 'pottsgrove' && e.secondSlug === 'spring-ford',
    );
    expect(pottsgrove).toBeDefined();
    expect(pottsgrove?.dateISO).toBe('2026-04-16');
    expect(pottsgrove?.url).toContain('?c=hs_OLM82iU6Udv26iPTZfg');
  });
});

describe('findScheduleEntry', () => {
  const entries = parseScheduleHtml(fixtureHtml);

  it('finds the Pottsgrove vs Spring-Ford game by date + opponent slug', () => {
    const entry = findScheduleEntry(entries, {
      dateISO: '2026-04-16',
      ownSlugCandidates: ['spring-ford', 'spring-ford-rams'],
      opponentSlugCandidates: ['pottsgrove'],
    });
    expect(entry).not.toBeNull();
    expect(entry?.url).toContain('pottsgrove-vs-spring-ford.htm');
    expect(entry?.url).toContain('?c=hs_OLM82iU6Udv26iPTZfg');
  });

  it('matches by substring (full mascot slug vs short slug)', () => {
    const entry = findScheduleEntry(entries, {
      dateISO: '2026-03-17',
      ownSlugCandidates: ['spring-ford-rams'],
      opponentSlugCandidates: ['avon-grove-red-devils'],
    });
    expect(entry).not.toBeNull();
    expect(entry?.url).toContain('avon-grove-vs-spring-ford.htm');
  });

  it('returns null on date mismatch', () => {
    const entry = findScheduleEntry(entries, {
      dateISO: '2026-04-15',
      ownSlugCandidates: ['spring-ford'],
      opponentSlugCandidates: ['pottsgrove'],
    });
    expect(entry).toBeNull();
  });

  it('returns null on opponent mismatch', () => {
    const entry = findScheduleEntry(entries, {
      dateISO: '2026-04-16',
      ownSlugCandidates: ['spring-ford'],
      opponentSlugCandidates: ['nonexistent-team'],
    });
    expect(entry).toBeNull();
  });

  it('returns null on empty candidate arrays', () => {
    expect(
      findScheduleEntry(entries, {
        dateISO: '2026-04-16',
        ownSlugCandidates: [],
        opponentSlugCandidates: ['pottsgrove'],
      }),
    ).toBeNull();
  });
});

describe('fetchTeamSchedule', () => {
  it('returns parsed entries when html is pre-loaded (test bypass)', async () => {
    const entries = await fetchTeamSchedule({
      schoolSlug: 'royersford/spring-ford-rams',
      html: fixtureHtml,
    });
    expect(entries).not.toBeNull();
    expect(entries?.length).toBe(15);
  });

  it('returns null on non-200 response', async () => {
    const fakeFetch = (async () =>
      ({
        ok: false,
        status: 404,
        text: async () => '',
      }) as Response) as typeof globalThis.fetch;
    const result = await fetchTeamSchedule({
      schoolSlug: 'foo/bar',
      fetchImpl: fakeFetch,
      sleepImpl: async () => {},
    });
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    const fakeFetch = (async () => {
      throw new Error('network down');
    }) as typeof globalThis.fetch;
    const result = await fetchTeamSchedule({
      schoolSlug: 'foo/bar',
      fetchImpl: fakeFetch,
      sleepImpl: async () => {},
    });
    expect(result).toBeNull();
  });

  it('returns null when response body is too short to be a real page', async () => {
    const fakeFetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => '<html></html>',
      }) as Response) as typeof globalThis.fetch;
    const result = await fetchTeamSchedule({
      schoolSlug: 'foo/bar',
      fetchImpl: fakeFetch,
      sleepImpl: async () => {},
    });
    expect(result).toBeNull();
  });

  it('passes Cookie header when opts.cookie is set', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return {
        ok: true,
        status: 200,
        text: async () => fixtureHtml,
      } as Response;
    }) as typeof globalThis.fetch;
    await fetchTeamSchedule({
      schoolSlug: 'foo/bar',
      fetchImpl: fakeFetch,
      sleepImpl: async () => {},
      cookie: 'sessid=abc123',
    });
    expect(capturedHeaders?.Cookie).toBe('sessid=abc123');
  });
});
