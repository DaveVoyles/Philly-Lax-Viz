# fixtures/

HTML snapshots used by parser & pipeline tests. Refresh by re-saving the live page and updating the table below.

## Index

| File | Source | Captured | Consumers |
|---|---|---|---|
| `scoreboard-sample.html` | phillylacrosse.com RSS scoreboard post (HTML body of a single feed item) | 2026-04-22 | `packages/ingest/src/parsers/__tests__/scoreboardPost.test.ts` |
| `summaries-sample.html` | phillylacrosse.com RSS game-summary post (HTML body of a single feed item) | 2026-04-22 | `packages/ingest/src/parsers/__tests__/summariesPost.test.ts`, `packages/ingest/src/pipelines/__tests__/summaries.test.ts` |
| `piaa-d1-rankings.snapshot.html` | piaad1.org rankings page snapshot (full page) | 2026-04-22 | `packages/ingest/src/__tests__/piaa.test.ts` |
| `maxpreps-pa-schools.snapshot.html` | maxpreps.com Pennsylvania schools listing (full page) | 2026-04-22 | `packages/ingest/src/__tests__/maxprepsSchools.test.ts` |
| `laxnumbers-team-harriton-2026.html` | laxnumbers.com team page for Harriton 2026 season (full page) | 2026-05-19 | parser fixture capture |

The first four fixtures were captured 2026-04-22 (per filesystem mtime; repo has no git history yet).

## How to refresh

1. Save the live page as HTML, replacing the file in place (keep the same filename).
2. Re-run the consumer tests:
   ```bash
   pnpm --filter @pll/ingest test
   ```
3. If parser output changes, update the test assertions in the same PR/wave.
4. Update the "Captured" date in the table above.

## Adding a new fixture

- Drop the file here with a descriptive lowercase-kebab filename and a `.html` (or `.snapshot.html` for full-page captures) extension.
- Add a row to the table above with source URL pattern, capture date, and the test file(s) that consume it.
- Reference the fixture from tests via a path relative to the test file (existing tests resolve up to repo root, e.g. `resolve(__dirname, '../../../../../fixtures/<name>.html')`).
