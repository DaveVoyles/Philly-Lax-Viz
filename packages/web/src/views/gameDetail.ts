import { ApiError, getGameDetail, type GameDetail, type GamePlayerStat } from '../api.js';
import type { GamePeriod, Team } from '@pll/shared';
import { renderGameHero } from '../components/postImage.js';

// Server's GET /api/games/:id embeds homeTeam/awayTeam (Wave 3 Lane 2, Yoda).
// The shared GameDetail type in api.ts doesn't yet declare them; Yoda owns
// api.ts edits this wave so we extend locally here.
type GameDetailWithTeams = GameDetail & {
  homeTeam: Team | null;
  awayTeam: Team | null;
};
import { formatDate } from '../util/format.js';
import { renderQuarterByQuarter } from '../charts/index.js';
import { renderGameFlow } from '../charts/gameFlow.js';
import { renderTeamBadge } from '../components/teamBadge.js';
import { renderAnomalyBanner } from '../components/anomalyBanner.js';
import { openCorrectionModal, type CorrectionTarget } from '../components/correctionModal.js';
import { renderConfidenceBadge } from '../util/confidence.js';
import { setOgMeta } from '../util/ogMeta.js';
import { ensureShareCss, getShareButtonHtml, initShareButtons } from '../util/share.js';

export function render(root: HTMLElement, params: Record<string, string>): void {
  ensureShareCss();
  setOgMeta({
    title: 'Game Detail | PhillyLaxStats',
    description: 'Final score, quarter splits, and player stat lines for Philly-area lacrosse games.',
    url: window.location.href,
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
    const err = document.createElement('p');
    err.className = 'error';
    err.textContent = 'Missing game id';
    root.appendChild(err);
    return;
  }

  const status = document.createElement('p');
  status.textContent = 'Loading…';
  root.appendChild(status);

  void load(root, status, id);
}

async function load(root: HTMLElement, status: HTMLElement, id: string): Promise<void> {
  let detail: GameDetailWithTeams;
  try {
    detail = (await getGameDetail(id)) as GameDetailWithTeams;
  } catch (err) {
    const msg = err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
    status.className = 'error';
    status.textContent = msg;
    return;
  }
  status.remove();

  const { game, periods, playerStats, homeTeam, awayTeam } = detail;

  const homeName = homeTeam?.name ?? `Team #${game.homeTeamId}`;
  const awayName = awayTeam?.name ?? `Team #${game.awayTeamId}`;
  const scoreLabel = game.postponed ? 'Postponed' : `${game.homeScore}-${game.awayScore}`;
  setOgMeta({
    title: `${homeName} vs ${awayName} - ${scoreLabel} | PhillyLaxStats`,
    description: `${formatDate(game.date)} - ${awayName} at ${homeName}.`,
    image: game.imageUrl ?? homeTeam?.logoUrl ?? awayTeam?.logoUrl ?? undefined,
    url: window.location.href,
  });
  const homeLogo = homeTeam?.logoUrl ?? null;
  const awayLogo = awayTeam?.logoUrl ?? null;

  const teamLabelById = new Map<number, string>();
  teamLabelById.set(game.homeTeamId, homeName);
  teamLabelById.set(game.awayTeamId, awayName);

  const headingWrap = document.createElement('div');
  headingWrap.style.cssText = 'display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap;';
  const heading = document.createElement('h1');
  heading.textContent = `${homeName} vs ${awayName}`;
  const shareTitle = game.postponed
    ? `${awayName} at ${homeName}`
    : `${awayName} ${game.awayScore} - ${game.homeScore} ${homeName}`;
  heading.insertAdjacentHTML('beforeend', getShareButtonHtml(shareTitle));
  headingWrap.appendChild(heading);
  root.appendChild(headingWrap);
  initShareButtons();

  root.appendChild(
    buildScoreboard(
      game,
      { id: game.homeTeamId, name: homeName, logoUrl: homeLogo },
      { id: game.awayTeamId, name: awayName, logoUrl: awayLogo },
    ),
  );

  // Wave 17 Lane 2 (Han) -- featured photo from the recap post if one was
  // extracted. Lazy-loaded; falls back gracefully if the CDN URL 404s.
  if (game.imageUrl) {
    root.appendChild(renderGameHero(game.imageUrl, `${awayName} at ${homeName}`));
  }

  const qChartSlot = document.createElement('div');
  qChartSlot.dataset['chart'] = 'quarterByQuarter';
  qChartSlot.className = 'chart-slot';
  root.appendChild(qChartSlot);
  if (periods.length > 0) {
    renderQuarterByQuarter(qChartSlot, {
      periods,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homeTeamName: homeName,
      awayTeamName: awayName,
    });

    const flowSlot = document.createElement('div');
    flowSlot.className = 'game-flow-slot';
    root.appendChild(flowSlot);
    renderGameFlow(
      flowSlot,
      periods,
      { id: game.homeTeamId, name: homeName },
      { id: game.awayTeamId, name: awayName },
    );
  }

  const byQuarterHeader = document.createElement('h2');
  byQuarterHeader.textContent = 'By Quarter';
  root.appendChild(byQuarterHeader);

  if (periods.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No quarter data recorded.';
    root.appendChild(empty);
  } else {
    root.appendChild(buildQuarterTable(periods, game, teamLabelById));
  }

  const statsHeader = document.createElement('h2');
  statsHeader.textContent = 'Player Stats';
  root.appendChild(statsHeader);

  // Group player stats by team name (server already sorted by team name then
  // player name). Render away team first, home team second.
  const grouped = new Map<string, GamePlayerStat[]>();
  for (const ps of playerStats) {
    const list = grouped.get(ps.teamName) ?? [];
    list.push(ps);
    grouped.set(ps.teamName, list);
  }

  // Surface a friendly notice for any side that scored but has no published
  // individual stats — a common gap in PhillyLacrosse.com summaries where only
  // the winning team's scorers are listed.
  const sideHasNoStats = (teamName: string, score: number): boolean =>
    !game.postponed && score > 0 && (grouped.get(teamName)?.length ?? 0) === 0;

  if (
    sideHasNoStats(homeName, game.homeScore) ||
    sideHasNoStats(awayName, game.awayScore)
  ) {
    if (sideHasNoStats(awayName, game.awayScore)) {
      root.appendChild(
        renderAnomalyBanner({
          kind: 'stats-not-published',
          gameId: game.id,
          teamName: awayName,
          teamScore: game.awayScore,
        }),
      );
    }
    if (sideHasNoStats(homeName, game.homeScore)) {
      root.appendChild(
        renderAnomalyBanner({
          kind: 'stats-not-published',
          gameId: game.id,
          teamName: homeName,
          teamScore: game.homeScore,
        }),
      );
    }
  }

  if (playerStats.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No player stats logged.';
    root.appendChild(empty);
    return;
  }

  const orderedTeamNames: string[] = [];
  if (grouped.has(awayName)) orderedTeamNames.push(awayName);
  if (grouped.has(homeName) && homeName !== awayName) orderedTeamNames.push(homeName);
  for (const name of [...grouped.keys()].sort()) {
    if (!orderedTeamNames.includes(name)) orderedTeamNames.push(name);
  }

  for (const teamName of orderedTeamNames) {
    const stats = grouped.get(teamName) ?? [];
    if (stats.length === 0) continue;
    const sub = document.createElement('h3');
    sub.textContent = teamName;
    root.appendChild(sub);

    // Wave H4 Lane 1 (Han) — surface ingest anomalies where the per-player
    // goal sum doesn't match the recorded team score for this side.
    const playerSum = stats.reduce((acc, s) => acc + (s.goals || 0), 0);
    const teamScore = teamScoreFor(teamName, game, homeName, awayName);
    if (!game.postponed && typeof teamScore === 'number' && playerSum > teamScore) {
      root.appendChild(
        renderAnomalyBanner({
          kind: 'team-score-exceeded',
          gameId: game.id,
          teamName,
          playerSum,
          teamScore,
        }),
      );
    }

    root.appendChild(buildPlayerStatsTable(stats, game, homeName, awayName));
  }
}

function teamScoreFor(
  teamName: string,
  game: { homeScore: number; awayScore: number },
  homeName: string,
  awayName: string,
): number | undefined {
  if (teamName === homeName) return game.homeScore;
  if (teamName === awayName) return game.awayScore;
  return undefined;
}

function buildScoreboard(
  game: {
    id?: number;
    date: string;
    awayScore: number;
    homeScore: number;
    otPeriods: number;
    postponed: boolean;
  },
  home: { id: number; name: string; logoUrl: string | null },
  away: { id: number; name: string; logoUrl: string | null },
): HTMLElement {
  const sb = document.createElement('div');
  sb.className = 'scoreboard';

  const sides = document.createElement('div');
  sides.className = 'scoreboard-sides';

  const awaySide = document.createElement('div');
  awaySide.className = 'scoreboard-side';
  const awayLabel = document.createElement('div');
  awayLabel.className = 'scoreboard-team';
  awayLabel.appendChild(
    renderTeamBadge({
      name: away.name,
      logoUrl: away.logoUrl,
      size: 'lg',
      href: `#/teams/${away.id}`,
    }),
  );
  const awayScore = document.createElement('div');
  awayScore.className = 'scoreboard-score';
  awayScore.textContent = game.postponed ? '-' : String(game.awayScore);
  const awayScoreButton = createGameScoreCorrectionButton(
    game,
    away,
    home,
    'away_score',
    'Away Score',
    game.awayScore,
  );
  if (awayScoreButton) awayScore.appendChild(awayScoreButton);
  awaySide.append(awayLabel, awayScore);

  const sep = document.createElement('div');
  sep.className = 'scoreboard-sep';
  sep.textContent = '@';

  const homeSide = document.createElement('div');
  homeSide.className = 'scoreboard-side';
  const homeLabel = document.createElement('div');
  homeLabel.className = 'scoreboard-team';
  homeLabel.appendChild(
    renderTeamBadge({
      name: home.name,
      logoUrl: home.logoUrl,
      size: 'lg',
      href: `#/teams/${home.id}`,
    }),
  );
  const homeScore = document.createElement('div');
  homeScore.className = 'scoreboard-score';
  homeScore.textContent = game.postponed ? '-' : String(game.homeScore);
  const homeScoreButton = createGameScoreCorrectionButton(
    game,
    away,
    home,
    'home_score',
    'Home Score',
    game.homeScore,
  );
  if (homeScoreButton) homeScore.appendChild(homeScoreButton);
  homeSide.append(homeLabel, homeScore);

  sides.append(awaySide, sep, homeSide);
  sb.appendChild(sides);

  const meta = document.createElement('div');
  meta.className = 'scoreboard-meta muted';
  let metaText = formatDate(game.date);
  if (game.otPeriods > 0) metaText += ` - OT${game.otPeriods > 1 ? `x${game.otPeriods}` : ''}`;
  if (game.postponed) metaText += ' - POSTPONED';
  meta.textContent = metaText;
  sb.appendChild(meta);

  return sb;
}

function buildQuarterTable(
  periods: GamePeriod[],
  game: { homeTeamId: number; awayTeamId: number },
  teamLabelById: Map<number, string>,
): HTMLElement {
  // Pivot: rows = team, columns = period 1..N (>4 = OT)
  const byTeam = new Map<number, Map<number, number>>();
  let maxPeriod = 4;
  for (const p of periods) {
    let row = byTeam.get(p.teamId);
    if (!row) {
      row = new Map();
      byTeam.set(p.teamId, row);
    }
    row.set(p.periodNumber, p.goals);
    if (p.periodNumber > maxPeriod) maxPeriod = p.periodNumber;
  }

  const table = document.createElement('table');
  table.className = 'stat quarter-table';

  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  const thTeam = document.createElement('th');
  thTeam.textContent = 'Team';
  trh.appendChild(thTeam);
  for (let i = 1; i <= maxPeriod; i += 1) {
    const th = document.createElement('th');
    th.textContent = i <= 4 ? `Q${i}` : `OT${i - 4}`;
    trh.appendChild(th);
  }
  const thTotal = document.createElement('th');
  thTotal.textContent = 'Total';
  trh.appendChild(thTotal);
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  // Render away first, home second (sports convention).
  const order = [game.awayTeamId, game.homeTeamId].filter((id) => byTeam.has(id));
  for (const id of byTeam.keys()) {
    if (!order.includes(id)) order.push(id);
  }

  for (const teamId of order) {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = teamLabelById.get(teamId) ?? `Team #${teamId}`;
    tr.appendChild(tdName);
    const row = byTeam.get(teamId) ?? new Map<number, number>();
    let total = 0;
    for (let i = 1; i <= maxPeriod; i += 1) {
      const td = document.createElement('td');
      const v = row.get(i);
      if (v === undefined) {
        td.textContent = '–';
      } else {
        td.textContent = String(v);
        total += v;
      }
      tr.appendChild(td);
    }
    const tdTotal = document.createElement('td');
    tdTotal.textContent = String(total);
    tdTotal.className = 'total-col';
    tr.appendChild(tdTotal);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

type CorrectableGameField =
  | 'goals'
  | 'assists'
  | 'ground_balls'
  | 'caused_turnovers'
  | 'saves'
  | 'fo_won'
  | 'fo_taken';

function buildPlayerStatsTable(
  stats: GamePlayerStat[],
  game: { date: string },
  homeName: string,
  awayName: string,
): HTMLElement {
  const table = document.createElement('table');
  table.className = 'stat player-stats';

  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const label of ['Player', 'G', 'A', 'Pts', 'GB', 'CT', 'Saves', 'FO']) {
    const th = document.createElement('th');
    th.textContent = label;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const ps of stats) {
    const tr = document.createElement('tr');

    const playerTd = document.createElement('td');
    const playerLink = document.createElement('a');
    playerLink.href = `#/players/${ps.playerId}`;
    playerLink.textContent = ps.playerName;
    playerTd.appendChild(playerLink);
    const badge = renderConfidenceBadge(ps.confidence);
    if (badge) playerTd.appendChild(badge);
    tr.appendChild(playerTd);

    tr.appendChild(createGameStatCell(ps, game, homeName, awayName, 'goals', 'Goals', ps.goals));
    tr.appendChild(createGameStatCell(ps, game, homeName, awayName, 'assists', 'Assists', ps.assists));

    const pointsTd = document.createElement('td');
    pointsTd.className = 'num';
    pointsTd.textContent = String(ps.goals + ps.assists);
    tr.appendChild(pointsTd);

    tr.appendChild(
      createGameStatCell(ps, game, homeName, awayName, 'ground_balls', 'Ground Balls', ps.groundBalls),
    );
    tr.appendChild(
      createGameStatCell(
        ps,
        game,
        homeName,
        awayName,
        'caused_turnovers',
        'Caused Turnovers',
        ps.causedTurnovers,
      ),
    );
    tr.appendChild(createGameStatCell(ps, game, homeName, awayName, 'saves', 'Saves', ps.saves));
    tr.appendChild(createGameFaceoffCell(ps, game, homeName, awayName));

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function createGameStatCell(
  stat: GamePlayerStat,
  game: { date: string },
  homeName: string,
  awayName: string,
  fieldName: CorrectableGameField,
  fieldLabel: string,
  currentValue: number,
): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'num';
  td.appendChild(document.createTextNode(String(currentValue)));

  const button = createGamePlayerCorrectionButton(
    stat,
    game,
    homeName,
    awayName,
    fieldName,
    fieldLabel,
    currentValue,
  );
  if (button) td.appendChild(button);

  return td;
}

function createGameFaceoffCell(
  stat: GamePlayerStat,
  game: { date: string },
  homeName: string,
  awayName: string,
): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'num';

  if (stat.foTaken <= 0) {
    td.textContent = '–';
    return td;
  }

  td.appendChild(document.createTextNode(String(stat.foWon)));
  const wonButton = createGamePlayerCorrectionButton(
    stat,
    game,
    homeName,
    awayName,
    'fo_won',
    'FO Won',
    stat.foWon,
  );
  if (wonButton) td.appendChild(wonButton);

  td.appendChild(document.createTextNode('/'));
  td.appendChild(document.createTextNode(String(stat.foTaken)));
  const takenButton = createGamePlayerCorrectionButton(
    stat,
    game,
    homeName,
    awayName,
    'fo_taken',
    'FO Taken',
    stat.foTaken,
  );
  if (takenButton) td.appendChild(takenButton);

  return td;
}

function createGamePlayerCorrectionButton(
  stat: GamePlayerStat,
  game: { date: string },
  homeName: string,
  awayName: string,
  fieldName: CorrectableGameField,
  fieldLabel: string,
  currentValue: number,
): HTMLButtonElement | null {
  if (typeof stat.id !== 'number') return null;

  const button = createCorrectionButtonElement();
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const target: CorrectionTarget = {
      entityType: 'player_stat',
      entityId: stat.id,
      fieldName,
      fieldLabel,
      currentValue,
      contextLabel: `${stat.playerName} - ${homeName} vs ${awayName} (${formatDate(game.date)})`,
    };
    openCorrectionModal(target);
  });
  return button;
}

function createGameScoreCorrectionButton(
  game: { id?: number; date: string; postponed: boolean },
  away: { name: string },
  home: { name: string },
  fieldName: 'home_score' | 'away_score',
  fieldLabel: 'Home Score' | 'Away Score',
  currentValue: number,
): HTMLButtonElement | null {
  if (typeof game.id !== 'number' || game.postponed) return null;
  const entityId = game.id;

  const button = createCorrectionButtonElement();
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const target: CorrectionTarget = {
      entityType: 'game',
      entityId,
      fieldName,
      fieldLabel,
      currentValue,
      contextLabel: `${home.name} vs ${away.name} (${formatDate(game.date)})`,
    };
    openCorrectionModal(target);
  });
  return button;
}

function createCorrectionButtonElement(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = 'Suggest a correction';
  button.setAttribute('aria-label', 'Suggest a correction');
  button.textContent = '✏️';
  button.style.cssText =
    'font-size: 0.75em; opacity: 0.6; cursor: pointer; background: none; border: none; padding: 0 4px;';
  button.addEventListener('mouseenter', () => {
    button.style.opacity = '1';
  });
  button.addEventListener('mouseleave', () => {
    button.style.opacity = '0.6';
  });
  return button;
}
