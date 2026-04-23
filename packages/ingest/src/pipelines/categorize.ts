// categorize.ts — classify a cached post into one of our three pipelines.
// Inputs: post URL/slug + raw HTML. Output: PipelineCategory or null (skip).

import type { RankingSource } from '@pll/shared';

export type PipelineCategory = 'scoreboard' | 'hs-summaries' | 'rankings';

export interface PostCategoryInfo {
  category: PipelineCategory;
  rankingSource?: RankingSource;
}

/**
 * Extract WordPress category-tag link labels from the post HTML. PhillyLacrosse
 * posts emit them as `rel="category tag">Label</a>`.
 */
export function extractCategoryTags(html: string): string[] {
  const tags: string[] = [];
  const re = /rel="category tag"[^>]*>([^<]+)</gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    tags.push((m[1] ?? '').trim());
  }
  return tags;
}

/**
 * Decide which pipeline (if any) should process this post. We rely on the
 * post's WordPress categories first, falling back to URL-slug heuristics for
 * legacy/odd posts.
 *
 * Returns null for posts we deliberately skip (girls, women's, men's college,
 * club tryout listings, off-topic news posts).
 */
export function categorizePost(slug: string, html: string): PostCategoryInfo | null {
  const tags = extractCategoryTags(html).map((t) => t.toLowerCase());
  const slugLc = slug.toLowerCase();

  // Scoreboard posts bundle both genders — keep them and let parsers section-filter.
  const isScoreboard = tags.some((t) => /scoreboard/.test(t)) || /scoreboard/.test(slugLc);

  // Hard-skip filters (girls / women's / college / non-game posts).
  if (!isScoreboard && /(?:^|-)(?:girls|womens|women)(?:-|$)/.test(slugLc)) return null;
  if (!isScoreboard && tags.some((t) => /(?:girl|women|female)/.test(t))) return null;
  if (!isScoreboard && /mens-college|college-super-7/.test(slugLc)) return null;
  if (!isScoreboard && tags.some((t) => /college/.test(t)) && !tags.some((t) => /high\s*school/.test(t))) {
    return null;
  }
  if (/club-tryouts|tryouts/.test(slugLc)) return null;
  if (/named-to-all|all-(?:big|acc|conference)/.test(slugLc)) return null;

  // Rankings.
  if (
    tags.some((t) => /ranking/.test(t)) ||
    /rankings?/.test(slugLc)
  ) {
    // Skip rankings that aren't boys (we already filtered girls above).
    // Differentiate philly vs pa-state.
    let source: RankingSource = 'philly';
    if (/pa-(?:lacrosse-)?state-rankings|pa-state/.test(slugLc)) source = 'pa-state';
    else if (tags.some((t) => /state/.test(t))) source = 'pa-state';
    return { category: 'rankings', rankingSource: source };
  }

  // HS summaries.
  if (
    tags.some((t) => /hs\s*summaries|high\s*school\s*summaries/.test(t)) ||
    /-summaries?(?:-|$)/.test(slugLc) ||
    // Saturday-boys posts sometimes drop "summaries" from the slug.
    /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)-boys/.test(slugLc)
  ) {
    return { category: 'hs-summaries' };
  }

  // Scoreboard.
  if (
    tags.some((t) => /scoreboard/.test(t)) ||
    /scoreboard/.test(slugLc)
  ) {
    return { category: 'scoreboard' };
  }

  return null;
}
