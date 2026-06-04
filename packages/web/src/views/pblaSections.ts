import { SEASONS, teamColor, teamPalette, teamSlug, type PblaSeason } from './pblaData.js';
import {
  attachBurstTarget,
  compareTeams,
  createSummaryCard,
  formatGameCardDate,
  formatSigned,
  mountCounter,
  observeOnEnter,
  parseGameTimestamp,
  pulseClass,
  renderSortHeader,
  restartCounter,
  setCounterValue,
  showElement,
  sortPlayers,
  sumGoalsFor,
  teamAbbrev,
  toggleSort,
  topPoints,
  topPointsPlayer,
} from './pblaHelpers.js';
import type { PlayerSortKey, SortHeader, SortState } from './pblaHelpers.js';
import { clearScopedCleanup, registerCleanup } from './pblaWebGL.js';

const cleanupFns = { push: registerCleanup } as unknown as Array<() => void>;

export function buildHero(root: HTMLElement): {
  selectorBar: HTMLElement;
  seasonContent: HTMLElement;
  webglHost: HTMLElement;
  liveBadge: HTMLAnchorElement;
  liveText: HTMLSpanElement;
} {
  const webglHost = document.createElement('div');
  webglHost.className = 'pbla-webgl';
  root.appendChild(webglHost);

  const shell = document.createElement('div');
  shell.className = 'pbla-shell';

  const hero = document.createElement('section');
  hero.className = 'pbla-panel pbla-hero';

  const copy = document.createElement('div');
  copy.className = 'pbla-hero__copy';

  const kicker = document.createElement('div');
  kicker.className = 'pbla-kicker';
  kicker.innerHTML = '<span class="pbla-kicker__dot"></span> PBLA';

  const heading = document.createElement('div');
  heading.innerHTML = `
    <h1 class="pbla-hero__title">Philadelphia Box Lacrosse<span class="pbla-hero__title-accent">Association</span></h1>
    <p class="pbla-hero__subtitle">The <a href="https://phillyboxlacrosse.org/" target="_blank" rel="noopener noreferrer" style="color:var(--pbla-accent,#00e4ff);text-decoration:underline;">Philadelphia Box Lacrosse Association</a> has delivered summer box lacrosse at Rizzo Rink since 1986, pairing weeknight games with league-wide scoring races, playoff drama, and a long-running local lacrosse tradition.</p>
  `;

  const liveBadge = document.createElement('a');
  liveBadge.className = 'pbla-live-badge';
  liveBadge.href = 'https://www.youtube.com/@PBLA_Official';
  liveBadge.target = '_blank';
  liveBadge.rel = 'noopener noreferrer';

  const liveIcon = document.createElement('span');
  liveIcon.className = 'pbla-live-icon';
  liveIcon.setAttribute('aria-hidden', 'true');
  liveIcon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.7 31.7 0 0 0 0 12a31.7 31.7 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.7 31.7 0 0 0 24 12a31.7 31.7 0 0 0-.5-5.8ZM9.6 15.7V8.3l6.4 3.7-6.4 3.7Z"/></svg>';

  const liveDot = document.createElement('span');
  liveDot.className = 'pbla-live-dot';
  liveDot.setAttribute('aria-hidden', 'true');

  const liveText = document.createElement('span');
  liveText.className = 'pbla-live-text';

  liveBadge.append(liveIcon, liveDot, liveText);

  const chips = document.createElement('div');
  chips.className = 'pbla-hero__chips';
  chips.innerHTML = `
    <span class="pbla-chip">Est. 1986</span>
    <span class="pbla-chip">7 Teams</span>
    <span class="pbla-chip">Rizzo Rink</span>
  `;

  copy.append(kicker, heading, liveBadge, chips);

  const side = document.createElement('div');
  side.className = 'pbla-hero__side';

  const selectorCard = document.createElement('aside');
  selectorCard.className = 'pbla-side-card';
  selectorCard.innerHTML = `
    <p class="pbla-side-card__eyebrow">📅 Season selector</p>
    <h2 class="pbla-side-card__title">Current table and last season finish</h2>
    <p class="pbla-side-card__text">Flip between the current ${SEASONS[0]?.year ?? 'live'} standings snapshot and the completed ${SEASONS[1]?.year ?? 'prior'} campaign to compare this summer's race with last year's playoff finish.</p>
  `;
  const selectorBar = document.createElement('div');
  selectorBar.className = 'pbla-season-bar';
  selectorCard.appendChild(selectorBar);

  const goalieCard = document.createElement('aside');
  goalieCard.className = 'pbla-side-card';
  goalieCard.innerHTML = `
    <p class="pbla-side-card__eyebrow">🧤 Top goalies</p>
    <h2 class="pbla-side-card__title">Save leaders this season</h2>
    <p class="pbla-side-card__text">Lowest goals-against average among goalies with at least 30 minutes played.</p>
  `;
  const goalieLane = document.createElement('div');
  goalieLane.className = 'pbla-goalie-lane';
  // Show top 4 goalies by GAA (lowest first), min 30 min played
  const currentSeason = SEASONS[0];
  const qualifiedGoalies = currentSeason
    ? currentSeason.goalies
        .filter((g) => g.min >= 30)
        .sort((a, b) => a.gaa - b.gaa)
        .slice(0, 4)
    : [];
  if (qualifiedGoalies.length > 0) {
    goalieLane.innerHTML = qualifiedGoalies
      .map(
        (g) => `
      <div class="pbla-goalie-pill" style="--team-color:${teamColor(g.team)}">
        <span class="pbla-goalie-pill__value">${g.gaa.toFixed(2)}</span>
        <span class="pbla-goalie-pill__label">${g.name.split(' ').pop()}</span>
        <span class="pbla-goalie-pill__team"><span class="pbla-goalie-pill__dot"></span>${teamAbbrev(g.team)}</span>
      </div>`,
      )
      .join('');
  } else {
    goalieLane.innerHTML = `
      <div class="pbla-goalie-pill"><span class="pbla-goalie-pill__value">--</span><span class="pbla-goalie-pill__label">No data yet</span></div>
    `;
  }
  goalieCard.appendChild(goalieLane);

  side.append(selectorCard, goalieCard);
  hero.append(copy, side);
  shell.appendChild(hero);

  const seasonContent = document.createElement('div');
  seasonContent.className = 'pbla-shell';
  shell.appendChild(seasonContent);

  const cta = document.createElement('section');
  cta.className = 'pbla-panel pbla-cta';
  cta.innerHTML = `
    <h2 class="pbla-cta__title">Watch PBLA and follow the league</h2>
    <p class="pbla-cta__text">Catch game night streams on PBLA TV, then track standings, scorers, and playoff movement from the official league site.</p>
    <div class="pbla-cta__links">
      <a class="pbla-cta__link" href="https://www.youtube.com/@PBLA_Official" target="_blank" rel="noopener noreferrer">PBLA TV</a>
      <a class="pbla-cta__link" href="https://phillyboxlacrosse.org/" target="_blank" rel="noopener noreferrer">PBLA website</a>
    </div>
  `;
  shell.appendChild(cta);

  root.appendChild(shell);
  return { selectorBar, seasonContent, webglHost, liveBadge, liveText };
}

function renderStandingsSection(
  season: PblaSeason,
  animate: boolean,
  webglHost: HTMLElement,
  token: number,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'pbla-panel pbla-section';

  const header = document.createElement('div');
  header.className = 'pbla-section__header';
  header.innerHTML = `
    <div>
      <span class="pbla-section__eyebrow">Season standings</span>
      <h2 class="pbla-section__title">Current standings</h2>
      <p class="pbla-section__subtitle">See where every team sits this season. Tap a team card for full roster and stats.</p>
    </div>
    <div class="pbla-section__meta">League ${season.year} - ${season.teams.length} clubs</div>
  `;
  section.appendChild(header);

  const ranked = [...season.teams].sort(compareTeams);
  const leagueRanks = new Map(ranked.map((team, index) => [team.id, index + 1]));
  const grid = document.createElement('div');
  grid.className = 'pbla-standings-grid';
  const cardCleanups: Array<() => void> = [];
  cleanupFns.push(() => clearScopedCleanup(cardCleanups));

  ranked.forEach((team, index) => {
    const color = teamColor(team.name);
    const palette = teamPalette(team.name);
    const card = document.createElement('a');
    const winPct = team.gp > 0 ? team.wins / team.gp : 0;
    card.className = 'pbla-team-card';
    card.href = `#/pbla/teams/${teamSlug(team.name)}`;
    card.style.setProperty('--team-color', color);
    card.style.setProperty('--team-secondary', palette.secondary);
    card.style.setProperty('--team-accent', palette.accent);

    const streakClass = team.streak.startsWith('W') ? 'pbla-streak pbla-streak--win' : 'pbla-streak pbla-streak--loss';
    card.innerHTML = `
      <div class="pbla-team-card__top">
        <div class="pbla-rank-pill">#${index + 1}</div>
        <div class="pbla-team-card__identity">
          <div class="pbla-team-card__headline">
            <span class="pbla-team-card__swatch" aria-hidden="true"></span>
            <h3 class="pbla-team-card__name">${team.name}</h3>
          </div>
          <div class="pbla-team-card__record">${team.wins}-${team.losses}-${team.ties} record across ${team.gp} games</div>
        </div>
        <div class="${streakClass}">${team.streak}</div>
      </div>
      <div class="pbla-team-card__stats">
        <div class="pbla-team-stat"><span class="pbla-team-stat__label" title="Standing points (3 per win)">Stg Pts</span><span class="pbla-team-stat__value" data-team-value="pts"></span></div>
        <div class="pbla-team-stat"><span class="pbla-team-stat__label" title="Goals for">GF</span><span class="pbla-team-stat__value" data-team-value="pf"></span></div>
        <div class="pbla-team-stat"><span class="pbla-team-stat__label" title="Goals against">GA</span><span class="pbla-team-stat__value" data-team-value="pa"></span></div>
        <div class="pbla-team-stat"><span class="pbla-team-stat__label" title="Goal differential (GF minus GA)">GD</span><span class="pbla-team-stat__value" data-team-value="diff"></span></div>
      </div>
      <div class="pbla-team-card__win">
        <div class="pbla-team-card__win-meta"><span>Win rate</span><span>${Math.round(winPct * 100)}%</span></div>
        <div class="pbla-win-track"><div class="pbla-win-bar" style="--win-pct:${winPct}"></div></div>
      </div>
    `;

    const ptsEl = card.querySelector<HTMLElement>('[data-team-value="pts"]');
    const pfEl = card.querySelector<HTMLElement>('[data-team-value="pf"]');
    const paEl = card.querySelector<HTMLElement>('[data-team-value="pa"]');
    const diffEl = card.querySelector<HTMLElement>('[data-team-value="diff"]');
    const swatchEl = card.querySelector<HTMLElement>('.pbla-team-card__swatch');
    const winBar = card.querySelector<HTMLElement>('.pbla-win-bar');

    const runCounters = (): void => {
      if (ptsEl) restartCounter(ptsEl, team.pts);
      if (pfEl) restartCounter(pfEl, team.pf);
      if (paEl) restartCounter(paEl, team.pa);
      if (diffEl) restartCounter(diffEl, team.diff, formatSigned);
    };

    observeOnEnter(card, animate, () => {
      winBar?.classList.add('is-visible');
      if (animate) {
        runCounters();
      } else {
        if (ptsEl) setCounterValue(ptsEl, team.pts);
        if (pfEl) setCounterValue(pfEl, team.pf);
        if (paEl) setCounterValue(paEl, team.pa);
        if (diffEl) setCounterValue(diffEl, team.diff, formatSigned);
      }
    }, cardCleanups);

    const retrigger = (): void => {
      if (!animate) return;
      runCounters();
      if (swatchEl) pulseClass(swatchEl, 'is-pulsing');
    };
    card.addEventListener('pointerenter', retrigger);
    card.addEventListener('focus', retrigger);
    cardCleanups.push(() => {
      card.removeEventListener('pointerenter', retrigger);
      card.removeEventListener('focus', retrigger);
    });

    showElement(card, animate, index * 80);
    attachBurstTarget(card, webglHost, color, token, cardCleanups);
    grid.appendChild(card);
  });

  section.appendChild(grid);
  return section;
}

function renderUpcomingGamesSection(season: PblaSeason, animate: boolean): HTMLElement {
  const now = Date.now();
  const sevenDaysOut = now + 7 * 24 * 60 * 60 * 1000;
  const upcoming = [...season.games]
    .filter((g) => {
      const ts = parseGameTimestamp(g);
      return ts > now && ts <= sevenDaysOut && g.homeScore === 0 && g.awayScore === 0;
    })
    .sort((a, b) => parseGameTimestamp(a) - parseGameTimestamp(b));

  const section = document.createElement('section');
  section.className = 'pbla-panel pbla-section';

  const header = document.createElement('div');
  header.className = 'pbla-section__header';
  header.innerHTML = `
    <div>
      <span class="pbla-section__eyebrow">&#128197; Upcoming games</span>
      <h2 class="pbla-section__title">Next up at Rizzo Rink</h2>
    </div>
    <div class="pbla-section__meta">${upcoming.length} game${upcoming.length !== 1 ? 's' : ''} scheduled</div>
  `;
  section.appendChild(header);

  if (upcoming.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pbla-games-empty';
    empty.textContent = 'No upcoming games scheduled yet. Check back soon for the next game night!';
    section.appendChild(empty);
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'pbla-games-grid';

  upcoming.slice(0, 10).forEach((game, index) => {
    const card = document.createElement('article');
    card.className = `pbla-game-card pbla-game-card--upcoming${game.isPlayoff ? ' pbla-game-card--playoff' : ''}`;

    const badges = [
      game.isPlayoff ? '<span class="pbla-game-card__badge pbla-game-card__badge--playoff">Playoff</span>' : '',
    ].filter(Boolean).join('');

    card.innerHTML = `
      <div class="pbla-game-card__top">
        <div class="pbla-game-card__date">${formatGameCardDate(game)}</div>
        ${badges ? `<div class="pbla-game-card__badges">${badges}</div>` : ''}
      </div>
      <div class="pbla-game-card__matchup">
        <span class="pbla-game-card__team">${game.awayTeam}</span>
        <span class="pbla-game-card__vs">at</span>
        <span class="pbla-game-card__team">${game.homeTeam}</span>
      </div>
      <div class="pbla-game-card__footer">
        <span class="pbla-game-card__time">${game.time}</span>
        <span class="pbla-game-card__location">${game.location}</span>
      </div>
    `;

    showElement(card, animate, index * 55);
    grid.appendChild(card);
  });

  section.appendChild(grid);
  return section;
}

function renderGamesSection(season: PblaSeason, animate: boolean): HTMLElement {
  // Only show games that have been played (non-zero score or forfeit note)
  const games = [...season.games]
    .filter((g) => g.homeScore + g.awayScore > 0 || /forfeit/i.test(g.note))
    .sort((a, b) => parseGameTimestamp(b) - parseGameTimestamp(a));
  const section = document.createElement('section');
  section.className = 'pbla-panel pbla-section';

  const header = document.createElement('div');
  header.className = 'pbla-section__header';
  header.innerHTML = `
    <div>
      <span class="pbla-section__eyebrow">Recent games</span>
      <h2 class="pbla-section__title">Latest results from Rizzo Rink</h2>

    </div>
    <div class="pbla-section__meta">${season.year} season - ${games.length} results</div>
  `;
  section.appendChild(header);

  if (games.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pbla-games-empty';
    empty.textContent = `No ${season.year} results recorded yet. Scores will appear here after game nights.`;
    section.appendChild(empty);
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'pbla-games-grid';
  section.appendChild(grid);

  let showAll = false;
  const toggle = games.length > 10 ? document.createElement('button') : null;
  if (toggle) {
    toggle.type = 'button';
    toggle.className = 'pbla-games-toggle';
    const handleToggle = (): void => {
      showAll = !showAll;
      renderCards();
    };
    toggle.addEventListener('click', handleToggle);
    cleanupFns.push(() => toggle.removeEventListener('click', handleToggle));
    section.appendChild(toggle);
  }

  function renderCards(): void {
    grid.replaceChildren();
    const visibleGames = showAll ? games : games.slice(0, 10);
    visibleGames.forEach((game, index) => {
      const awayWins = game.awayScore > game.homeScore;
      const homeWins = game.homeScore > game.awayScore;
      const card = document.createElement('article');
      card.className = `pbla-game-card${game.isPlayoff ? ' pbla-game-card--playoff' : ''}`;

      const badges = [
        game.isPlayoff ? '<span class="pbla-game-card__badge pbla-game-card__badge--playoff">Playoff</span>' : '',
        game.note ? `<span class="pbla-game-card__badge pbla-game-card__badge--note">${game.note}</span>` : '',
      ].filter(Boolean).join('');

      card.innerHTML = `
        <div class="pbla-game-card__top">
          <div class="pbla-game-card__date">${formatGameCardDate(game)}</div>
          ${badges ? `<div class="pbla-game-card__badges">${badges}</div>` : ''}
        </div>
        <div class="pbla-game-card__matchup">
          <span class="pbla-game-card__team${awayWins ? ' pbla-game-card__team--winner' : ''}">${game.awayTeam} ${game.awayScore}</span>
          <span class="pbla-game-card__vs">at</span>
          <span class="pbla-game-card__team${homeWins ? ' pbla-game-card__team--winner' : ''}">${game.homeTeam} ${game.homeScore}</span>
        </div>
      `;

      showElement(card, animate, index * 55);
      grid.appendChild(card);
    });

    if (toggle) {
      toggle.textContent = showAll ? 'Show fewer games' : `Show all ${games.length} games`;
    }
  }

  renderCards();
  return section;
}

function renderLeadersSection(
  season: PblaSeason,
  animate: boolean,
  webglHost: HTMLElement,
  token: number,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'pbla-panel pbla-section';

  const header = document.createElement('div');
  header.className = 'pbla-section__header';
  header.innerHTML = `
    <div>
      <h2 class="pbla-section__title" style="font-size:1.6rem">&#127942; Scoring leaders</h2>
    </div>
    <div class="pbla-section__meta">Top 20 players - ${season.year} season</div>
  `;
  section.appendChild(header);

  const shell = document.createElement('div');
  shell.className = 'pbla-table-shell';

  const table = document.createElement('table');
  table.className = 'pbla-data-table pbla-leaders-table';
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);
  shell.appendChild(table);
  section.appendChild(shell);

  const topPointTotal = topPoints(season);
  const rowCleanups: Array<() => void> = [];
  cleanupFns.push(() => clearScopedCleanup(rowCleanups));
  const headers: SortHeader<PlayerSortKey>[] = [
    { key: 'name', label: 'Name' },
    { key: 'team', label: 'Team' },
    { key: 'points', label: 'Pts' },
    { key: 'goals', label: 'G' },
    { key: 'assists', label: 'A' },
    { key: 'gp', label: 'GP' },
    { key: 'pim', label: 'PIM' },
  ];
  let sortState: SortState<PlayerSortKey> = { key: 'points', direction: 'desc' };

  const renderTable = (): void => {
    clearScopedCleanup(rowCleanups);
    const headRow = document.createElement('tr');
    const rankHeader = document.createElement('th');
    rankHeader.textContent = '#';
    headRow.appendChild(rankHeader);
    headers.forEach((entry) => {
      headRow.appendChild(
        renderSortHeader(entry, sortState, (key) => {
          sortState = toggleSort(sortState, key);
          renderTable();
        }),
      );
    });
    thead.replaceChildren(headRow);

    const players = sortPlayers(season.players, sortState).slice(0, 20);
    tbody.replaceChildren();
    players.forEach((player, index) => {
      const row = document.createElement('tr');
      const swatch = teamColor(player.team);
      row.className = 'pbla-leaders-row';
      row.style.setProperty('--team-color', swatch);

      row.innerHTML = `
        <td class="pbla-rank-cell">${index + 1}${index === 0 ? '<span class="pbla-rank-fire" aria-hidden="true">🔥</span>' : ''}</td>
        <td class="pbla-player-cell"><span class="pbla-player-cell__jersey">#${player.jersey ?? '?'}</span><span class="pbla-player-cell__name">${player.name ?? 'Unknown'}</span></td>
        <td class="pbla-team-cell"><span class="pbla-team-swatch" style="--swatch-color:${swatch}"></span>${player.team ?? '\u2014'}</td>
        <td class="pbla-points-cell" data-player-value="points"></td>
        <td data-player-value="goals"></td>
        <td data-player-value="assists"></td>
        <td data-player-value="gp"></td>
        <td data-player-value="pim"></td>
      `;

      const pointsBar = document.createElement('div');
      pointsBar.className = 'pbla-points-bar';
      pointsBar.style.setProperty('--team-color', swatch);
      pointsBar.style.setProperty('--pts-pct', String(topPointTotal > 0 ? player.points / topPointTotal : 0));
      pointsBar.style.width = '100%';
      row.prepend(pointsBar);

      const gpEl = row.querySelector<HTMLElement>('[data-player-value="gp"]');
      const goalsEl = row.querySelector<HTMLElement>('[data-player-value="goals"]');
      const assistsEl = row.querySelector<HTMLElement>('[data-player-value="assists"]');
      const pointsEl = row.querySelector<HTMLElement>('[data-player-value="points"]');
      const pimEl = row.querySelector<HTMLElement>('[data-player-value="pim"]');
      const baseDelay = 140 + index * 72;
      if (gpEl) mountCounter(gpEl, player.gp, animate, baseDelay);
      if (goalsEl) mountCounter(goalsEl, player.goals, animate, baseDelay + 35);
      if (assistsEl) mountCounter(assistsEl, player.assists, animate, baseDelay + 70);
      if (pimEl) mountCounter(pimEl, player.pim, animate, baseDelay + 145);
      if (pointsEl && !animate) setCounterValue(pointsEl, player.points);

      observeOnEnter(row, animate, () => {
        pointsBar.classList.add('is-visible');
        if (pointsEl) {
          if (animate) {
            restartCounter(pointsEl, player.points);
          } else {
            setCounterValue(pointsEl, player.points);
          }
        }
      }, rowCleanups);

      showElement(row, animate, index * 72);
      if (index < 5) attachBurstTarget(row, webglHost, swatch, token, rowCleanups);
      tbody.appendChild(row);
    });
  };

  renderTable();
  return section;
}

function renderSeasonSummary(season: PblaSeason, animate: boolean): HTMLElement {
  const summary = document.createElement('section');
  summary.className = 'pbla-season-summary';

  const ranked = [...season.teams].sort(compareTeams);
  const leader = ranked[0];
  const leaderName = leader ? leader.name : 'PBLA';
  const leaderGoals = leader ? leader.pf : 0;
  summary.append(
    createSummaryCard('Teams', season.teams.length, `${season.teams.length} teams competing this season.`, animate, 60),
    createSummaryCard('Total goals', sumGoalsFor(season), `${leaderName} leads the league in scoring with ${leaderGoals}.`, animate, 140),
    createSummaryCard('Points leader', topPoints(season), `Most points by a single player this season by ${topPointsPlayer(season)}.`, animate, 220),
    createSummaryCard('Games played', season.teams.reduce((sum, t) => sum + t.gp, 0) / 2, 'Total games completed so far.', animate, 300),
  );

  return summary;
}

function renderSeasonContent(
  host: HTMLElement,
  season: PblaSeason,
  animate: boolean,
  webglHost: HTMLElement,
  token: number,
): void {
  host.replaceChildren();
  const ranked = [...season.teams].sort(compareTeams);
  const leader = ranked[0];
  const leadPlayer = season.players[0];

  const overview = document.createElement('section');
  overview.className = 'pbla-panel pbla-section';
  overview.innerHTML = `
    <div class="pbla-section__header">
      <div>
        <span class="pbla-section__eyebrow">Season overview</span>
        <h2 class="pbla-section__title">${season.year === (SEASONS[0]?.year ?? season.year) ? `The ${season.year} season is underway` : `${season.year} season final standings`}</h2>
        <p class="pbla-section__subtitle">${season.year === (SEASONS[0]?.year ?? season.year) ? 'Games are live every Monday and Wednesday night at Rizzo Rink. Check the standings, see who is leading the scoring race, and find out where your team sits.' : `The ${season.year} PBLA season is in the books. Here is how every team finished and who took home the hardware.`}</p>
      </div>
      <div class="pbla-section__meta">${leader ? `<span class="pbla-meta-badge pbla-meta-badge--gold">🏆 1st place: ${leader.name}</span>` : ''}${leadPlayer ? `<span class="pbla-meta-badge pbla-meta-badge--fire">🔥 Points leader: ${leadPlayer.name}</span>` : ''}</div>
    </div>
  `;
  overview.appendChild(renderSeasonSummary(season, animate));
  host.appendChild(overview);
  host.appendChild(renderStandingsSection(season, animate, webglHost, token));
  host.appendChild(renderUpcomingGamesSection(season, animate));
  host.appendChild(renderGamesSection(season, animate));
  host.appendChild(renderLeadersSection(season, animate, webglHost, token));
}

function renderSeasonButtons(
  host: HTMLElement,
  seasons: PblaSeason[],
  selectedYear: number,
  onSelect: (year: number) => void,
): void {
  host.replaceChildren();
  seasons.forEach((season) => {
    const button = document.createElement('button');
    const handleClick = (): void => onSelect(season.year);
    button.type = 'button';
    button.className = `pbla-season-btn${season.year === selectedYear ? ' is-active' : ''}`;
    button.textContent = 'label' in season && typeof season.label === 'string' ? season.label : String(season.year);
    button.setAttribute('aria-pressed', String(season.year === selectedYear));
    button.addEventListener('click', handleClick);
    cleanupFns.push(() => button.removeEventListener('click', handleClick));
    host.appendChild(button);
  });
}

export {
  renderGamesSection,
  renderLeadersSection,
  renderSeasonButtons,
  renderSeasonContent,
  renderSeasonSummary,
  renderStandingsSection,
  renderUpcomingGamesSection,
};
