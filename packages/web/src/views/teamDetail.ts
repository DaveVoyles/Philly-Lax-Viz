import {
  ApiError,
  getH2HTeams,
  getLaxNumbersTeamRating,
  getTeamDetail,
  getTeams,
  getTeamTopScorers,
  getTeamUpcoming,
  type H2HTeamsResponse,
  type ScheduleGame,
  type TeamDetail,
  type TeamSeasonRecord,
  type TopScorerEntry,
} from '../api.js';
import type { Game } from '@pll/shared';
import { IS_STATIC, staticFetch } from '../staticLoader.js';
import { formatDate, formatRecord } from '../util/format.js';
import { renderSeasonRecord, renderTopScorers } from '../charts/index.js';
import { extractScoreTrend, renderTeamScoreTrend } from '../charts/teamScoreTrend.js';
import {
  renderTeamRadarChart,
  type RadarOpponentRef,
  type TeamLike,
} from '../components/teamRadarChart.js';
import { renderTeamBadge } from '../components/teamBadge.js';
import { renderProvenanceBadge } from '../components/provenanceBadge.js';
import { renderPiaaBadge, piaaBadgeTooltip } from '../components/piaaBadge.js';
import { ensureGlossaryCss, glossaryIcon } from '../util/glossary.js';
import { wrapResponsive } from '../util/responsiveTable.js';
import { injectJsonLd, teamJsonLd } from '../util/jsonLd.js';
import { setPageMeta } from '../util/pageMeta.js';
import { ensureShareCss, getShareButtonHtml, initShareButtons } from '../util/share.js';
import { buildStreakChip, ensureStreakChipStyles } from '../util/streakChip.js';
import { createAutoCounter } from '../components/animatedCounter.js';

function isValidHexColor(color: string | null | undefined): color is string {
  return !!color && /^#[0-9a-fA-F]{3,6}$/.test(color);
}

function renderAnimatedRecordValue(
  target: HTMLElement,
  record: { wins: number; losses: number; ties: number },
  duration = 800,
): void {
  target.replaceChildren(
    createAutoCounter({ value: record.wins, duration }),
    document.createTextNode('-'),
    createAutoCounter({ value: record.losses, duration }),
  );

  if (record.ties > 0) {
    target.append(document.createTextNode('-'), createAutoCounter({ value: record.ties, duration }));
  }
}

function buildNumericCallout(label: string, value: number, duration = 800): HTMLDivElement {
  const callout = document.createElement('div');
  callout.className = 'record-callout';

  const calloutLabel = document.createElement('span');
  calloutLabel.className = 'callout-label';
  calloutLabel.textContent = label;

  const calloutValue = document.createElement('span');
  calloutValue.className = 'callout-value';
  calloutValue.appendChild(createAutoCounter({ value, duration }));

  callout.append(calloutLabel, calloutValue);
  return callout;
}

export function render(root: HTMLElement, params: Record<string, string>): void {
  ensureShareCss();
  ensureGlossaryCss();
  ensureStreakChipStyles();
  setPageMeta({
    title: 'Team',
    description: 'Season record, roster coverage, and game log for Philly-area lacrosse teams.',
  });
  root.replaceChildren();

  const back = document.createElement('p');
  back.className = 'muted';
  const backLink = document.createElement('a');
  backLink.href = '#/';
  backLink.textContent = '← back to dashboard';
  back.appendChild(backLink);
  root.appendChild(back);

  const id = params['id'] ?? '';
  if (!id) {
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = 'Missing team id';
    root.appendChild(p);
    return;
  }

  const status = document.createElement('p');
  status.textContent = 'Loading…';
  root.appendChild(status);

  void load(root, status, id);
}

async function load(root: HTMLElement, status: HTMLElement, id: string): Promise<void> {
  let detail: TeamDetail;
  let teams: TeamSeasonRecord[] = [];
  const teamsById = new Map<number, string>();
  try {
    const [d, t] = await Promise.all([getTeamDetail(id), getTeams()]);
    detail = d;
    teams = t;
    for (const team of teams) teamsById.set(team.id, team.name);
  } catch (err) {
    const msg = err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
    status.className = 'error';
    status.textContent = msg;
    return;
  }
  status.remove();

  setPageMeta({
    title: detail.team.name,
    description: `${formatRecord(detail.record)} record, game log, and roster for ${detail.team.name}.`,
    image: detail.team.logoUrl ?? undefined,
  });
  injectJsonLd(
    teamJsonLd({
      name: detail.team.name,
      id: String(detail.team.id),
      record: formatRecord(detail.record),
    }),
  );

  const teamId = detail.team.id;
  const seasonRecord = teams.find((team) => team.id === teamId);

  const hero = document.createElement('div');
  hero.className = 'team-detail-hero';
  hero.style.cssText = 'display:flex; align-items:flex-start; gap:1rem; flex-wrap:wrap;';

  const titleBlock = document.createElement('div');
  titleBlock.style.cssText = 'display:flex; flex-direction:column; gap:0.25rem;';

  const heading = document.createElement('h1');
  heading.style.cssText = 'display:flex; align-items:center; gap:1rem; flex-wrap:wrap; margin:0;';
  heading.appendChild(
    renderTeamBadge({
      name: detail.team.name,
      logoUrl: detail.team.logoUrl,
      primaryColor: detail.team.primaryColor,
      size: 'xl',
    }),
  );
  heading.insertAdjacentHTML('beforeend', getShareButtonHtml(detail.team.name));
  titleBlock.appendChild(heading);

  if (detail.team.nickname) {
    const nickname = document.createElement('span');
    nickname.textContent = `"${detail.team.nickname}"`;
    nickname.style.fontSize = '0.95rem';
    if (isValidHexColor(detail.team.secondaryColor)) {
      nickname.style.color = detail.team.secondaryColor;
    } else {
      nickname.className = 'muted';
    }
    titleBlock.appendChild(nickname);
  }

  hero.appendChild(titleBlock);
  root.appendChild(hero);
  initShareButtons();

  const callouts = document.createElement('div');
  callouts.className = 'callout-row';

  const piaa = detail.team.piaa ?? null;
  const derived = detail.derivedRecord ?? detail.team.derivedRecord ?? {
    wins: detail.record.wins,
    losses: detail.record.losses,
    ties: detail.record.ties,
  };

  // Primary record callout. When PIAA exists, it IS the record (server authoritative).
  // Otherwise we fall back to PhillyLacrosse-derived. Per 2026-04-23 decision, PIAA
  // always wins on conflict, so we don't show two competing primary numbers anymore.
  const recordCallout = document.createElement('div');
  recordCallout.className = piaa ? 'record-callout record-callout--piaa' : 'record-callout';
  const recordLabel = document.createElement('span');
  recordLabel.className = 'callout-label';
  recordLabel.style.cssText = 'display:flex; align-items:center; gap:.4rem;';
  const recordLabelText = document.createElement('span');
  recordLabelText.textContent = piaa ? 'PIAA Record' : 'Record';
  recordLabel.append(
    recordLabelText,
    renderProvenanceBadge({ source: piaa ? 'piaa' : 'phillylacrosse' }),
  );
  if (piaa && detail.team.piaaValidation) {
    const badge = renderPiaaBadge({
      validation: detail.team.piaaValidation,
      derived,
      piaa,
      linkToSource: true,
      variant: 'label',
      hideUnmapped: true,
    });
    if (badge) recordLabel.appendChild(badge);
  }
  const recordValue = document.createElement('span');
  recordValue.className = 'callout-value';
  recordValue.style.cssText = 'display:inline-flex; align-items:center; flex-wrap:wrap;';
  renderAnimatedRecordValue(recordValue, detail.record);
  const streakChip = buildStreakChip(seasonRecord?.streak);
  if (streakChip) recordValue.append(document.createTextNode(' '), streakChip);
  recordCallout.append(recordLabel, recordValue);
  if (piaa && (piaa.seed !== null || piaa.classification)) {
    const sub = document.createElement('span');
    sub.className = 'muted';
    sub.style.fontSize = '.85rem';
    const parts: string[] = [];
    if (piaa.seed !== null) parts.push(`Seed #${piaa.seed}`);
    if (piaa.classification) parts.push(piaa.classification);
    sub.textContent = `(${parts.join(', ')})`;
    recordCallout.appendChild(sub);
  }
  callouts.appendChild(recordCallout);

  // Secondary: PhillyLacrosse-derived record (only shown when PIAA is the primary
  // and the two disagree — pure transparency, not authoritative).
  if (
    piaa &&
    (derived.wins !== piaa.wins || derived.losses !== piaa.losses || derived.ties !== piaa.ties)
  ) {
    const derivedCallout = document.createElement('div');
    derivedCallout.className = 'record-callout record-callout--secondary';
    const derivedLabel = document.createElement('span');
    derivedLabel.className = 'callout-label';
    derivedLabel.style.cssText = 'display:flex; align-items:center; gap:.4rem;';
    const derivedLabelText = document.createElement('span');
    derivedLabelText.textContent = 'PhillyLacrosse coverage';
    derivedLabel.append(derivedLabelText, renderProvenanceBadge({ source: 'phillylacrosse' }));
    const derivedValue = document.createElement('span');
    derivedValue.className = 'callout-value';
    derivedValue.style.cssText = 'display:inline-flex; align-items:center; flex-wrap:wrap;';
    renderAnimatedRecordValue(derivedValue, derived);
    derivedCallout.append(derivedLabel, derivedValue);
    const note = document.createElement('span');
    note.className = 'muted';
    note.style.fontSize = '.85rem';
    note.textContent = '(non-authoritative — PIAA is source of truth)';
    derivedCallout.appendChild(note);
    callouts.appendChild(derivedCallout);
  }

  if (detail.recentRanking !== null) {
    const rankCallout = document.createElement('div');
    rankCallout.className = 'record-callout';
    const rankLabel = document.createElement('span');
    rankLabel.className = 'callout-label';
    rankLabel.textContent = 'Latest Ranking';
    const rankValue = document.createElement('span');
    rankValue.className = 'callout-value';
    rankValue.textContent = `#${detail.recentRanking}`;
    rankCallout.append(rankLabel, rankValue);
    callouts.appendChild(rankCallout);
  }

  if (seasonRecord) {
    callouts.append(
      buildNumericCallout('Goals For', seasonRecord.goalsFor),
      buildNumericCallout('Goals Against', seasonRecord.goalsAgainst),
    );
  }

  root.appendChild(callouts);

  type TeamRatingEntry = Awaited<ReturnType<typeof getLaxNumbersTeamRating>>[number];
  void (async () => {
    try {
      const ratings: TeamRatingEntry[] = IS_STATIC
        ? (await Promise.all([
            staticFetch<Array<TeamRatingEntry & { teamId: number }>>('/data/2026/laxnumbers-ratings-inter-ac.json'),
            staticFetch<Array<TeamRatingEntry & { teamId: number }>>('/data/2026/laxnumbers-ratings-private-schools.json'),
          ]))
            .flat()
            .filter((entry) => entry.teamId === teamId)
            .sort((a, b) => b.year - a.year)
        : await getLaxNumbersTeamRating(teamId);
      const entry = ratings[0];
      if (!entry || !callouts.isConnected) return;

      const ratingCard = document.createElement('div');
      ratingCard.className = 'record-callout';
      const ratingLabel = document.createElement('span');
      ratingLabel.className = 'callout-label';
      ratingLabel.textContent = 'LaxNumbers Rating';
      const ratingValue = document.createElement('span');
      ratingValue.className = 'callout-value';
      ratingValue.textContent = `#${entry.ranking} (${entry.rating.toFixed(1)})`;
      ratingCard.append(ratingLabel, ratingValue);
      callouts.appendChild(ratingCard);
    } catch {
      // Fail silently so missing ratings never block or break the team detail page.
    }
  })();

  // PIAA cross-validation panel — replaces the Wave 7 ad-hoc note.
  // Uses the server-computed `piaaValidation` block so the badge here matches
  // the dashboard cards exactly.
  const validation = detail.team.piaaValidation ?? null;
  if (piaa && validation && validation.status !== 'unmapped') {
    const panel = document.createElement('div');
    panel.className = `piaa-validation-panel piaa-validation-panel--${validation.status}`;
    const heading = document.createElement('strong');
    heading.style.cssText = 'display:flex; align-items:center; gap:.4rem;';
    const inlineBadge = renderPiaaBadge({
      validation,
      derived,
      piaa,
      linkToSource: false,
    });
    if (inlineBadge) heading.appendChild(inlineBadge);
    const headingText = document.createElement('span');
    headingText.textContent = piaaBadgeTooltip(validation, derived, piaa);
    heading.appendChild(headingText);
    panel.appendChild(heading);

    const sub = document.createElement('div');
    sub.className = 'muted';
    sub.style.cssText = 'font-size:.9rem; margin-top:.25rem;';
    const ourWl = `${derived.wins}-${derived.losses}`;
    const piaaWl = `${piaa.wins}-${piaa.losses}`;
    const classBits = [piaa.classification ? `Class ${piaa.classification}` : null]
      .filter((x): x is string => x !== null)
      .join(', ');
    sub.textContent =
      `PhillyLacrosse derived: ${ourWl} · PIAA official: ${piaaWl}` +
      (classBits ? ` (${classBits})` : '') +
      ' · PIAA used as source of truth · ';
    const link = document.createElement('a');
    link.href = validation.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'verify on PIAA D1 →';
    sub.appendChild(link);
    panel.appendChild(sub);
    root.appendChild(panel);
  }

  const coverage = detail.team.coverage ?? null;
  if (coverage && coverage.piaaGames !== null && coverage.gap !== null) {
    if (coverage.gap > 0) {
      const cn = document.createElement('p');
      cn.className = 'coverage-note';
      cn.textContent =
        `PhillyLacrosse coverage: ${coverage.ourGames} of ${coverage.piaaGames}` +
        ` games tracked (${coverage.gap} missing)`;
      root.appendChild(cn);
    } else if (coverage.gap === 0) {
      const cn = document.createElement('p');
      cn.className = 'coverage-note coverage-note--complete';
      cn.textContent =
        `PhillyLacrosse coverage complete: ${coverage.ourGames} of ${coverage.piaaGames} games tracked`;
      root.appendChild(cn);
    }
  }

  // Wrap pie chart + radar in a side-by-side row
  const chartsRow = document.createElement('div');
  chartsRow.style.cssText = 'display:flex; gap:1.5rem; align-items:flex-start; flex-wrap:wrap; margin:1rem 0;';

  const chartSlot = document.createElement('div');
  chartSlot.dataset['chart'] = 'seasonRecord';
  chartSlot.className = 'chart-slot';
  chartSlot.style.cssText = 'flex:1 1 200px; max-width:280px;';
  chartsRow.appendChild(chartSlot);
  if (detail.record.wins + detail.record.losses + detail.record.ties > 0) {
    renderSeasonRecord(chartSlot, detail.record);
  }

  // RFC 05 — Team strength radar. Render beside the season record so
  // a coach scrolling for a profile sees the polygon before the long
  // schedule list. Only attempt when this team appears in the league
  // population (otherwise we can't percentile-rank meaningfully).
  const focalRow = teams.find((t) => t.id === teamId) ?? null;
  if (focalRow) {
    const population: TeamLike[] = teams
      .filter((t) => t.wins + t.losses > 0)
      .map(toTeamLike);
    const opponents: RadarOpponentRef[] = detail.games.map((g) => ({
      opponentId: g.homeTeamId === teamId ? g.awayTeamId : g.homeTeamId,
      postponed: g.postponed,
    }));
    if (population.length >= 2) {
      const radarWrap = document.createElement('div');
      radarWrap.style.cssText = 'flex:1 1 240px; max-width:320px;';
      const radarHeader = document.createElement('h3');
      radarHeader.textContent = 'Team strength';
      radarHeader.style.cssText = 'margin:0 0 0.25rem; font-size:0.9rem;';
      radarWrap.appendChild(radarHeader);
      const radarHost = document.createElement('div');
      radarHost.className = 'team-radar-host';
      radarWrap.appendChild(radarHost);
      chartsRow.appendChild(radarWrap);
      renderTeamRadarChart(radarHost, {
        team: toTeamLike(focalRow),
        population,
        opponents,
      }, { width: 220, height: 220 });
    }
  }

  root.appendChild(chartsRow);

  const topScorersHeader = document.createElement('h2');
  topScorersHeader.textContent = 'Top Scorers';
  root.appendChild(topScorersHeader);

  const topScorersGlossary = document.createElement('p');
  topScorersGlossary.className = 'muted';
  topScorersGlossary.style.cssText = 'margin-top:-0.5rem; margin-bottom:0.75rem;';
  topScorersGlossary.innerHTML = `Points${glossaryIcon('Points')} = Goals${glossaryIcon('Goals')} + Assists${glossaryIcon('Assists')}`;
  root.appendChild(topScorersGlossary);

  const topScorersSlot = document.createElement('div');
  topScorersSlot.dataset['chart'] = 'topScorers';
  topScorersSlot.className = 'chart-slot';
  root.appendChild(topScorersSlot);
  void loadTopScorers(topScorersSlot, teamId);

  const gamesHeader = document.createElement('h2');
  gamesHeader.textContent = 'Season Games';
  root.appendChild(gamesHeader);

  // W16 L2 (Leia) — show the next 3 upcoming games for this team if the
  // schedule scrape has populated them. Lazy-fetched so a missing endpoint
  // never blocks the rest of the page.
  const upcomingSlot = document.createElement('div');
  upcomingSlot.className = 'team-upcoming-slot';
  root.appendChild(upcomingSlot);
  void loadUpcoming(upcomingSlot, teamId);

  const gamesPlayed = detail.games.filter((g) => !g.postponed);
  if (gamesPlayed.length === 0 && detail.games.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No games yet.';
    root.appendChild(empty);
    return;
  }

  // Wave H7 Lane 3 (Leia) — season scoring trend (GF/GA per completed game).
  // Hidden when the team has zero completed games so we never render an empty
  // chart for fresh-roster teams or pre-season views.
  const trendPoints = extractScoreTrend(detail.games, teamId);
  if (trendPoints.length > 0) {
    const trendHeader = document.createElement('h2');
    trendHeader.textContent = 'Season scoring trend';
    root.appendChild(trendHeader);

    const trendCanvas = document.createElement('canvas');
    trendCanvas.className = 'team-score-trend';
    trendCanvas.dataset['chart'] = 'teamScoreTrend';
    root.appendChild(trendCanvas);
    renderTeamScoreTrend(trendCanvas, trendPoints);
  }

  root.appendChild(wrapResponsive(buildGamesTable(detail.games, teamId, teamsById)));
}

/**
 * W/L/T/pending badge for a single game row. Pure helper so the test suite can
 * verify outcomes without spinning up a DOM. Score-vs-score wins over the
 * `postponed` flag for non-postponed games; missing scores → pending.
 */
export function resultBadge(
  myScore: number | null | undefined,
  oppScore: number | null | undefined,
  postponed: boolean,
): { label: string; className: string; aria: string } {
  if (postponed || !isFiniteScore(myScore) || !isFiniteScore(oppScore)) {
    return { label: '—', className: 'result-pending', aria: 'Pending' };
  }
  if (myScore > oppScore) return { label: '✅ W', className: 'result-w', aria: 'Win' };
  if (myScore < oppScore) return { label: '❌ L', className: 'result-l', aria: 'Loss' };
  return { label: '⚪ T', className: 'result-t', aria: 'Tie' };
}

function isFiniteScore(s: unknown): s is number {
  return typeof s === 'number' && Number.isFinite(s);
}

function toTeamLike(t: TeamSeasonRecord): TeamLike {
  return {
    id: t.id,
    name: t.name,
    wins: t.wins,
    losses: t.losses,
    goalsFor: t.goalsFor,
    goalsAgainst: t.goalsAgainst,
  };
}

async function loadTopScorers(slot: HTMLElement, teamId: number): Promise<void> {
  let scorers: TopScorerEntry[];
  try {
    scorers = await getTeamTopScorers(teamId, 5);
  } catch (err) {
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
    slot.replaceChildren(p);
    return;
  }
  if (scorers.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No player scoring stats yet for this team.';
    slot.replaceChildren(p);
    return;
  }
  renderTopScorers(
    slot,
    scorers.map((s) => ({ playerName: s.playerName, goals: s.goals, assists: s.assists })),
  );
}

function getUpcomingOpponentId(game: ScheduleGame, teamId: number): number | null {
  const opponentId = game.homeTeamId === teamId ? game.awayTeamId : game.homeTeamId;
  return typeof opponentId === 'number' && Number.isInteger(opponentId) && opponentId > 0
    ? opponentId
    : null;
}

const UPCOMING_H2H_STYLE_ID = 'team-upcoming-h2h-chip-styles';

interface UpcomingH2HRecord {
  wins: number;
  losses: number;
  ties: number;
}

function ensureUpcomingH2HChipStyles(): void {
  if (document.getElementById(UPCOMING_H2H_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = UPCOMING_H2H_STYLE_ID;
  style.textContent = `.h2h-chip { font-size: 0.65rem; font-weight: 700; padding: 1px 5px; border-radius: 3px; display: inline-block; margin-left: 6px; text-decoration: none; vertical-align: middle; }
.h2h-lead { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
.h2h-trail { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
.h2h-even { background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; }`;
  document.head.appendChild(style);
}

function readUpcomingH2HRecord(h2h: H2HTeamsResponse, focusTeamId: number): UpcomingH2HRecord | null {
  const focusSide =
    h2h.a?.teamId === focusTeamId ? h2h.a : h2h.b?.teamId === focusTeamId ? h2h.b : null;
  if (focusSide === null) return null;
  return {
    wins: focusSide.wins,
    losses: focusSide.losses,
    ties: focusSide.ties,
  };
}

export function h2hChipHtml(
  teamId: number,
  opponentId: number,
  wins: number,
  losses: number,
  ties: number,
): string {
  const record = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  const cssClass = wins > losses ? 'h2h-lead' : wins < losses ? 'h2h-trail' : 'h2h-even';
  return `<a href="#/h2h?team1=${teamId}&team2=${opponentId}" class="h2h-chip ${cssClass}" title="All-time H2H record">${record} H2H</a>`;
}

async function hydrateUpcomingH2HChips(container: HTMLElement, focusTeamId: number): Promise<void> {
  const slots = Array.from(container.querySelectorAll<HTMLElement>('[data-h2h-slot][data-opponent-id]'));
  const opponentIds = [
    ...new Set(
      slots
        .map((slot) => Number(slot.dataset['opponentId']))
        .filter((opponentId) => Number.isInteger(opponentId) && opponentId > 0),
    ),
  ];
  if (opponentIds.length === 0) return;

  const results = await Promise.allSettled(
    opponentIds.map(async (opponentId) => ({
      opponentId,
      h2h: await getH2HTeams(focusTeamId, opponentId),
    })),
  );

  const records = new Map<number, UpcomingH2HRecord>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const record = readUpcomingH2HRecord(result.value.h2h, focusTeamId);
    if (record) records.set(result.value.opponentId, record);
  }

  for (const slot of slots) {
    const opponentId = Number(slot.dataset['opponentId']);
    const record = records.get(opponentId);
    if (!record) continue;
    slot.innerHTML = h2hChipHtml(
      focusTeamId,
      opponentId,
      record.wins,
      record.losses,
      record.ties,
    );
  }
}

async function loadUpcoming(slot: HTMLElement, teamId: number): Promise<void> {
  let games: ScheduleGame[];
  try {
    const res = await getTeamUpcoming(teamId, 3);
    games = res.games;
  } catch {
    // Silent — upcoming widget is best-effort, never blocks page render.
    return;
  }
  if (games.length === 0) return;

  const heading = document.createElement('h2');
  heading.textContent = 'Upcoming Games';
  slot.appendChild(heading);

  const ul = document.createElement('ul');
  ul.className = 'team-upcoming-list';
  ul.style.cssText = 'list-style:none; padding:0; margin:0 0 1rem; display:flex; flex-direction:column; gap:0.4rem;';
  for (const g of games) {
    const li = document.createElement('li');
    li.style.cssText =
      'display:flex; align-items:center; justify-content:space-between; gap:0.75rem; padding:0.5rem 0.75rem; border:1px solid var(--border, #2a2a2a); border-radius:6px; background:var(--card-bg, #181818);';
    const isHome = g.homeTeamId === teamId;
    const oppId = getUpcomingOpponentId(g, teamId);
    const oppName = isHome ? g.awayTeamName : g.homeTeamName;
    const oppKey = isHome ? (g.awayTeamSlug ?? g.awayTeamId) : (g.homeTeamSlug ?? g.homeTeamId);
    const left = document.createElement('span');
    const date = document.createElement('strong');
    date.textContent = formatDate(g.gameDate);
    left.appendChild(date);
    const sep = document.createTextNode(isHome ? ' vs ' : ' at ');
    left.appendChild(sep);
    if (oppKey != null) {
      const a = document.createElement('a');
      a.href = `#/teams/${encodeURIComponent(String(oppKey))}`;
      a.textContent = oppName;
      left.appendChild(a);
    } else {
      const span = document.createElement('span');
      span.textContent = oppName;
      left.appendChild(span);
    }
    if (!IS_STATIC && oppId !== null) {
      const h2hSlot = document.createElement('span');
      h2hSlot.setAttribute('data-h2h-slot', '');
      h2hSlot.dataset['opponentId'] = String(oppId);
      left.appendChild(h2hSlot);
    }
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.style.cssText = 'font-size:0.85rem;';
    meta.textContent = g.source;
    li.appendChild(left);
    li.appendChild(meta);
    ul.appendChild(li);
  }
  slot.appendChild(ul);

  if (!IS_STATIC) {
    ensureUpcomingH2HChipStyles();
    void Promise.allSettled([hydrateUpcomingH2HChips(ul, teamId)]);
  }
}

function buildGamesTable(games: Game[], teamId: number, teamsById: Map<number, string>): HTMLTableElement {
  const sorted = [...games].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.id - a.id;
  });

  const table = document.createElement('table');
  table.className = 'stat season-games';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const label of ['Date', 'Opponent', 'H/A', 'Score', 'Result']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === 'H/A') th.classList.add('col-secondary');
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const g of sorted) {
    const isHome = g.homeTeamId === teamId;
    const opponentId = isHome ? g.awayTeamId : g.homeTeamId;
    const myScore = isHome ? g.homeScore : g.awayScore;
    const oppScore = isHome ? g.awayScore : g.homeScore;

    const tr = document.createElement('tr');
    tr.className = 'row-link';
    tr.tabIndex = 0;
    tr.setAttribute('role', 'link');
    const go = (): void => {
      window.location.hash = `#/game/${g.id}`;
    };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });

    const tdDate = document.createElement('td');
    tdDate.textContent = formatDate(g.date);
    tr.appendChild(tdDate);

    const tdOpp = document.createElement('td');
    const oppLink = document.createElement('a');
    oppLink.href = `#/teams/${opponentId}`;
    oppLink.textContent = teamsById.get(opponentId) ?? `Team #${opponentId}`;
    oppLink.addEventListener('click', (e) => e.stopPropagation());
    tdOpp.appendChild(oppLink);
    tr.appendChild(tdOpp);

    const tdHa = document.createElement('td');
    tdHa.textContent = isHome ? 'Home' : 'Away';
    tdHa.classList.add('col-secondary');
    tr.appendChild(tdHa);

    const tdScore = document.createElement('td');
    if (g.postponed) {
      tdScore.textContent = 'Postponed';
    } else {
      tdScore.textContent =
        `${myScore}–${oppScore}` +
        (g.otPeriods > 0 ? ` (OT${g.otPeriods > 1 ? `×${g.otPeriods}` : ''})` : '');
    }
    tr.appendChild(tdScore);

    const tdResult = document.createElement('td');
    const badge = resultBadge(myScore, oppScore, g.postponed);
    const span = document.createElement('span');
    span.className = `result-badge ${badge.className}`;
    span.textContent = badge.label;
    span.setAttribute('aria-label', badge.aria);
    span.title = badge.aria;
    tdResult.appendChild(span);
    tr.appendChild(tdResult);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}
