// postImages.test.ts -- Wave 17 Lane 2 (Han). Extractor unit tests.
import { describe, it, expect } from 'vitest';
import { extractPostImages } from '../../pipelines/postImages.js';

describe('extractPostImages', () => {
  it('prefers og:image when present', () => {
    const html = `
<html><head>
<meta property="og:image" content="https://cdn.example.com/post/recap.jpg" />
</head><body>
<div class="entry-content"><img src="https://example.com/sponsor-banner.jpg" alt="ad" /></div>
</body></html>`;
    const out = extractPostImages(html);
    expect(out).toHaveLength(1);
    expect(out[0]!.url).toBe('https://cdn.example.com/post/recap.jpg');
    expect(out[0]!.source).toBe('og');
  });

  it('skips sponsor images and falls through to first non-sponsor body img', () => {
    const html = `
<html><head></head><body>
<article class="entry-content">
  <img src="https://i0.wp.com/phillylacrosse.com/wp-content/uploads/2025/03/fusion.jpg" alt="" />
  <img src="https://i0.wp.com/phillylacrosse.com/wp-content/uploads/2024/10/granite-run.png" alt="Sponsor: Granite Run" />
  <img src="https://i0.wp.com/phillylacrosse.com/wp-content/uploads/2025/04/recap-photo.jpg" alt="Game recap" width="600" height="400" />
</article>
</body></html>`;
    const out = extractPostImages(html);
    expect(out).toHaveLength(1);
    expect(out[0]!.url).toContain('recap-photo.jpg');
    expect(out[0]!.altText).toBe('Game recap');
    expect(out[0]!.width).toBe(600);
    expect(out[0]!.height).toBe(400);
    expect(out[0]!.source).toBe('body-img');
  });

  it('returns empty array when only sponsor images present', () => {
    const html = `
<html><body><div class="entry-content">
  <img src="https://example.com/sponsor.png" alt="" />
  <img src="https://example.com/granite-run-banner.jpg" alt="" />
</div></body></html>`;
    const out = extractPostImages(html);
    expect(out).toHaveLength(0);
  });

  it('decodes HTML entities in URLs', () => {
    const html = `
<html><body><div class="entry-content">
  <img src="https://i0.wp.com/img.jpg?fit=300%2C200&#038;ssl=1" alt="x" />
</div></body></html>`;
    const out = extractPostImages(html);
    expect(out).toHaveLength(1);
    expect(out[0]!.url).toBe('https://i0.wp.com/img.jpg?fit=300%2C200&ssl=1');
  });
});
