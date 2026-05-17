import {
  ApiError,
  getH2HTeams,
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
import { wrapResponsive } from '../util/responsiveTable.js';
import { shareOrCopy, currentPageUrl } from '../util/share.js';

function isValidHexColor(color: string | null | undefined): color is string {
  return !!color && /^#[0-9a-fA-F]{3,6}$/.test(color);
}

export function render(root: HTMLElement, params: Record<string, string>): void {
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

  const teamId = detail.team.id;

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

  const shareBtn = document.createElement('button');
  shareBtn.textContent = 'Share';
  shareBtn.title = 'Copy link to this team';
  shareBtn.style.cssText =
    'font-size:0.8rem; padding:0.2rem 0.6rem; border:1px solid var(--border); ' +
    'border-radius:4px; background:none; color:var(--accent); cursor:pointer;';
  shareBtn.addEventListener('click', () => {
    void shareOrCopy(`${detail.team.name} - Philly Lacrosse`, currentPageUrl());
  });

  hero.append(titleBlock, shareBtn);
  root.appendChild(hero);

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
    });
    if (badge) recordLabel.appendChild(badge);
  }
  const recordValue = document.createElement('span');
  recordValue.className = 'callout-value';
  recordValue.textContent = formatRecord(detail.record);
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
    derivedValue.textContent = formatRecord(derived);
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

  root.appendChild(callouts);

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

  const chartSlot = document.createElement('div');
  chartSlot.dataset['chart'] = 'seasonRecord';
  chartSlot.className = 'chart-slot';
  root.appendChild(chartSlot);
  if (detail.record.wins + detail.record.losses + detail.record.ties > 0) {
    renderSeasonRecord(chartSlot, detail.record);
  }

  // RFC 05 — Team strength radar. Render right under the season record so
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
      const radarHeader = document.createElement('h2');
      radarHeader.textContent = 'Team strength radar';
      root.appendChild(radarHeader);
      const radarHost = document.createElement('div');
      radarHost.className = 'team-radar-host';
      root.appendChild(radarHost);
      renderTeamRadarChart(radarHost, {
        team: toTeamLike(focalRow),
        population,
        opponents,
      });
    }
  }

  const topScorersHeader = document.createElement('h2');
  topScorersHeader.textContent = 'Top Scorers';
  root.appendChild(topScorersHeader);

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

async function fetchUpcomingH2HRecords(
  focusTeamId: number,
  games: ScheduleGame[],
): Promise<Map<number, H2HTeamsResponse>> {
  const opponentIds = games
    .map((game) => getUpcomingOpponentId(game, focusTeamId))
    .filter((opponentId): opponentId is number => opponentId !== null);
  const uniqueOpponentIds = [...new Set(opponentIds)];
  const results = await Promise.allSettled(
    uniqueOpponentIds.map(async (opponentId) => ({
      opponentId,
      data: await getH2HTeams(focusTeamId, opponentId),
    })),
  );
  const records = new Map<number, H2HTeamsResponse>();
  for (const result of results) {
    if (result.status === 'fulfilled') {
      records.set(result.value.opponentId, result.value.data);
    }
  }
  return records;
}

function buildUpcomingH2HChip(
  h2h: H2HTeamsResponse,
  focusTeamId: number,
  opponentId: number,
): HTMLAnchorElement {
  const focusSide =
    h2h.a?.teamId === focusTeamId ? h2h.a : h2h.b?.teamId === focusTeamId ? h2h.b : null;
  const label =
    focusSide === null
      ? 'H2H'
      : focusSide.gamesPlayed > 0
        ? `${focusSide.wins}W-${focusSide.losses}L${focusSide.ties > 0 ? `-${focusSide.ties}T` : ''} all time`
        : 'No history';
  const chip = document.createElement('a');
  chip.href = `#/h2h?mode=teams&a=${encodeURIComponent(String(focusTeamId))}&b=${encodeURIComponent(String(opponentId))}`;
  chip.textContent = label;
  chip.className = 'muted';
  chip.style.cssText =
    'display:inline-flex; align-items:center; margin-left:0.5rem; font-size:0.8rem; white-space:nowrap;';
  return chip;
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

  const h2hByOpponent = await fetchUpcomingH2HRecords(teamId, games);

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
    if (oppId !== null) {
      const h2h = h2hByOpponent.get(oppId);
      if (h2h) left.appendChild(buildUpcomingH2HChip(h2h, teamId, oppId));
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
