import { describe, it, expect } from 'vitest';
import { categorizePost, extractCategoryTags } from '../categorize.js';

describe('extractCategoryTags', () => {
  it('extracts WP rel="category tag" labels', () => {
    const html = `<a rel="category tag">Boy's/Men's</a><a rel="category tag" href="x">High School</a>`;
    expect(extractCategoryTags(html)).toEqual(["Boy's/Men's", 'High School']);
  });
});

describe('categorizePost', () => {
  it('detects scoreboard via category tag', () => {
    const html = `<a rel="category tag">Boy's/Men's</a><a rel="category tag">Scoreboard</a>`;
    expect(categorizePost('philly-lacrosse-scoreboard-2', html)).toEqual({ category: 'scoreboard' });
  });
  it('detects hs-summaries via slug', () => {
    expect(categorizePost('tuesday-boys-summaries-x', '')).toEqual({ category: 'hs-summaries' });
    expect(categorizePost('saturday-boys-sponsored-by-x', '')).toEqual({ category: 'hs-summaries' });
  });
  it('detects rankings (philly source) via slug', () => {
    expect(categorizePost('phillylacrosse-boys-rankings-x', '')).toEqual({
      category: 'rankings',
      rankingSource: 'philly',
    });
  });
  it('detects rankings (pa-state source) via slug', () => {
    expect(categorizePost('boys-pa-lacrosse-state-rankings-week-6', '')).toEqual({
      category: 'rankings',
      rankingSource: 'pa-state',
    });
  });
  it('skips girls/women/college/tryouts', () => {
    expect(categorizePost('listing-of-philly-girls-club-tryouts', '')).toBeNull();
    expect(categorizePost('philly-women-named-to-all-big-ten', '')).toBeNull();
    expect(categorizePost('philly-mens-college-super-7-rankings', '')).toBeNull();
    expect(categorizePost('philly-boys-club-tryouts-summer', '')).toBeNull();
  });
  it('returns null for unrelated posts', () => {
    expect(categorizePost('an-interview-with-coach-x', '')).toBeNull();
  });
});
