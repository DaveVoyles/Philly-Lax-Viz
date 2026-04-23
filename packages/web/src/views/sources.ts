// W17 L3 (R2) — /sources transparency page.
//
// Plain DOM rendering (no innerHTML for any value that comes from JSON) so
// nothing here can be HTML-injected even if a future ingest field leaks
// through. Lazy-imported from main.ts to keep the entry chunk lean.

import { ApiError } from '../api.js';
import { apiUrl } from '../apiBase.js';

interface FreshnessResponse {
  scoreboardLast: string | null;
  recapsLast: string | null;
  rankingsLast: string | null;
  scheduleLast: string | null;
  piaaLast: string | null;
  aliasesLast: string | null;
  lastIngestAt: string | null;
  counts: {
    teams: number;
    games: number;
    players: number;
    scheduleGames: number;
    playerAliases: number;
    piaaTeams: number;
  };
  generatedAt: string;
}

const ISSUE_TRACKER =
  'https://github.com/davevoyles/Philly-Lacrosse-Vis/issues/new?labels=data-correction&title=Data%20correction%3A%20%3Cdescribe%3E';

interface SourceCard {
  id: string;
  title: string;
  what: string;
  url: string | null;
  urlLabel: string | null;
  notes: string;
  // Pull a freshness timestamp from the response.
  freshness: (f: FreshnessResponse) => string | null;
  // Optional count to surface (e.g. "535 games").
  countLabel?: (f: FreshnessResponse) => string | null;
}

const SOURCES: SourceCard[] = [
  {
    id: 'scoreboard',
    title: 'Game scores + recaps',
    what:
      'PhillyLacrosse.com RSS feed, categories hs-scoreboard and hs-summaries. Recaps include final scores, period breakdowns, and player stat lines.',
    url: 'https://phillylacrosse.com/category/hs-scoreboard/',
    urlLabel: 'phillylacrosse.com/category/hs-scoreboard',
    notes:
      'Auto-updated nightly via the GitHub Actions ingest cron. Player stats parsed from prose with a confidence score.',
    freshness: (f) => f.scoreboardLast ?? f.recapsLast,
    countLabel: (f) => `${f.counts.games} games, ${f.counts.players} players`,
  },
  {
    id: 'piaa',
    title: 'PIAA validation (ground truth)',
    what:
      'PIAA District 1 official rankings and team records for boys lacrosse. Authoritative for District 1 public schools.',
    url: 'https://piaad1.org/sports/spring-sports/lacrosse-b/scores-and-rankings/',
    urlLabel: 'piaad1.org/.../scores-and-rankings',
    notes:
      'PIAA wins/losses override our derived counts when they disagree. Private and out-of-district teams are NOT in PIAA so coverage gaps are expected.',
    freshness: (f) => f.piaaLast,
    countLabel: (f) => `${f.counts.piaaTeams} PIAA teams`,
  },
  {
    id: 'schedule',
    title: 'Upcoming schedule',
    what:
      'PIAA District 1 CSV export of scheduled games (Leia, W16). Used to render the Schedule view and surface upcoming matchups.',
    url: 'https://piaad1.org/sports/spring-sports/lacrosse-b/scores-and-rankings/',
    urlLabel: 'piaad1.org schedule export',
    notes: 'Refreshed alongside the rankings scrape; staleness shown below.',
    freshness: (f) => f.scheduleLast,
    countLabel: (f) =>
      f.counts.scheduleGames > 0 ? `${f.counts.scheduleGames} scheduled games` : null,
  },
  {
    id: 'branding',
    title: 'Team branding (colors, nicknames, logos)',
    what:
      'Hand-curated by maintainers (R2, W16). Logos pulled from MaxPreps with manual overrides where MaxPreps is missing or wrong.',
    url: 'https://www.maxpreps.com',
    urlLabel: 'maxpreps.com',
    notes:
      'Hex colors and short nicknames live in the teams table. Submit a correction if a logo is wrong or low-resolution.',
    freshness: () => null,
    countLabel: (f) => `${f.counts.teams} teams`,
  },
  {
    id: 'aliases',
    title: 'Player aliases',
    what:
      'Auto-deduplicated via Levenshtein distance (Yoda, W12) plus a manual alias table for nicknames (e.g. "Will" -> "William") and recap typos.',
    url: null,
    urlLabel: null,
    notes:
      'A player with a missing or duplicate stat line is usually an alias miss. File an issue with the recap URL.',
    freshness: (f) => f.aliasesLast,
    countLabel: (f) =>
      f.counts.playerAliases > 0
        ? `${f.counts.playerAliases} curated aliases`
        : 'Auto-dedup only',
  },
];

function fmtTimestamp(iso: string | null): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'never';
  const d = new Date(t);
  return d.toLocaleString();
}

function relative(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const ms = Date.now() - t;
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

async function fetchFreshness(): Promise<FreshnessResponse | null> {
  try {
    const res = await fetch(apiUrl('/api/freshness'));
    if (!res.ok) throw new ApiError('freshness fetch failed', res.status, '/api/freshness');
    return (await res.json()) as FreshnessResponse;
  } catch {
    return null;
  }
}

function makeCard(card: SourceCard, freshness: FreshnessResponse | null): HTMLElement {
  const article = document.createElement('article');
  article.className = 'source-card';
  article.id = `source-${card.id}`;

  const h2 = document.createElement('h2');
  h2.textContent = card.title;
  article.appendChild(h2);

  const what = document.createElement('p');
  what.textContent = card.what;
  article.appendChild(what);

  if (card.url) {
    const linkP = document.createElement('p');
    const a = document.createElement('a');
    a.href = card.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = card.urlLabel ?? card.url;
    linkP.appendChild(document.createTextNode('Source: '));
    linkP.appendChild(a);
    article.appendChild(linkP);
  }

  const notes = document.createElement('p');
  notes.className = 'muted';
  notes.textContent = card.notes;
  article.appendChild(notes);

  const meta = document.createElement('dl');
  meta.className = 'source-meta';

  const freshnessIso = freshness ? card.freshness(freshness) : null;
  const dt1 = document.createElement('dt');
  dt1.textContent = 'Last updated';
  const dd1 = document.createElement('dd');
  dd1.textContent = freshness === null
    ? 'unknown (offline)'
    : freshnessIso === null
      ? 'manual / not auto-tracked'
      : `${fmtTimestamp(freshnessIso)} (${relative(freshnessIso)})`;
  meta.appendChild(dt1);
  meta.appendChild(dd1);

  const countLabel = freshness && card.countLabel ? card.countLabel(freshness) : null;
  if (countLabel) {
    const dt2 = document.createElement('dt');
    dt2.textContent = 'Coverage';
    const dd2 = document.createElement('dd');
    dd2.textContent = countLabel;
    meta.appendChild(dt2);
    meta.appendChild(dd2);
  }

  const dt3 = document.createElement('dt');
  dt3.textContent = 'Suggest a correction';
  const dd3 = document.createElement('dd');
  const issueA = document.createElement('a');
  issueA.href = ISSUE_TRACKER;
  issueA.target = '_blank';
  issueA.rel = 'noopener noreferrer';
  issueA.textContent = 'Open a GitHub issue';
  dd3.appendChild(issueA);
  meta.appendChild(dt3);
  meta.appendChild(dd3);

  article.appendChild(meta);
  return article;
}

export function render(root: HTMLElement, _params: Record<string, string>): void {
  root.replaceChildren();

  const h1 = document.createElement('h1');
  h1.textContent = 'Where this data comes from';
  root.appendChild(h1);

  const intro = document.createElement('p');
  intro.className = 'muted';
  intro.textContent =
    'Philly Lacrosse Vis is a community project. Every number you see traces back to one of the public sources below. If something looks wrong, please file an issue with the recap URL or a screenshot - we will fix it.';
  root.appendChild(intro);

  const grid = document.createElement('div');
  grid.className = 'sources-grid';
  root.appendChild(grid);

  // Render skeletons immediately so the page is never blank, then enrich
  // with freshness data once /api/freshness resolves.
  const skeleton = SOURCES.map((s) => {
    const card = makeCard(s, null);
    grid.appendChild(card);
    return { id: s.id };
  });

  void fetchFreshness().then((f) => {
    if (!f) return;
    grid.replaceChildren();
    for (const s of SOURCES) {
      grid.appendChild(makeCard(s, f));
    }
    void skeleton;
  });
}
