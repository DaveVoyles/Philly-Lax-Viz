import { type DashboardTopScorer, type TeamSeasonRecord } from '../../api.js';
import { mountHypeCard, type HypeCardHandle, type HypePlayerData } from '../../components/hypeCard.js';
import { shouldMountWebGL } from '../../util/motionPrefs.js';

function teamWins(t: TeamSeasonRecord): number {
  if (typeof t.wins === 'number' && t.wins > 0) return t.wins;
  const dr = (t as unknown as { derivedRecord?: { wins?: number } }).derivedRecord;
  return dr?.wins ?? 0;
}

function teamLosses(t: TeamSeasonRecord): number {
  if (typeof t.losses === 'number' && t.losses > 0) return t.losses;
  const dr = (t as unknown as { derivedRecord?: { losses?: number } }).derivedRecord;
  return dr?.losses ?? 0;
}

/**
 * Renders the player hype card from pre-fetched bundle data.
 * Called by the dashboard after getDashboardBundle() resolves.
 */
export function renderPlayerHypeCard(
  host: HTMLElement,
  topScorer: DashboardTopScorer,
): HypeCardHandle | null {
  if (host.children.length > 0) return null;
  const data: HypePlayerData = {
    playerName: topScorer.playerName,
    teamName: topScorer.teamName,
    teamLogoUrl: topScorer.teamLogoUrl ?? undefined,
    statLabel: 'Goals this season',
    statValue: topScorer.value,
    secondaryStat: topScorer.assists > 0 ? { label: 'Assists', value: topScorer.assists } : undefined,
    playerHref: `#/players/${topScorer.playerId}`,
  };
  if (shouldMountWebGL()) {
    return mountHypeCard(host, data);
  }
  const card = document.createElement('a');
  card.href = data.playerHref;
  card.style.cssText = 'display:block; padding:0.75rem 1.25rem; border-radius:12px; background:#0e1119; border:2px solid #ffd166; text-decoration:none; color:inherit;';
  card.innerHTML = `<span style="color:#ffd166;font-weight:700;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;">&#128293; Player of the Week</span>
    <div style="font-size:1.1rem;font-weight:700;color:#e5e7eb;margin-top:0.25rem;">${data.playerName}</div>
    <div style="font-size:0.8rem;color:#9ca3af;">${data.teamName}</div>
    <div style="font-size:1.5rem;font-weight:700;color:#ffd166;margin-top:0.4rem;">${Math.round(data.statValue)} <span style="font-size:0.8rem;font-weight:400;color:#9ca3af;">${data.statLabel}</span></div>`;
  host.appendChild(card);
  return null;
}

/**
 * Renders the team hype card from pre-fetched bundle data.
 * Called by the dashboard after getDashboardBundle() resolves.
 */
export function renderTeamHypeCard(
  host: HTMLElement,
  teams: TeamSeasonRecord[],
): HypeCardHandle | null {
  if (host.children.length > 0 || !teams.length) return null;
  const ranked = teams
    .filter((t) => teamWins(t) + teamLosses(t) >= 3)
    .sort((a, b) => {
      const aWins = teamWins(a);
      const bWins = teamWins(b);
      if (bWins !== aWins) return bWins - aWins;
      return teamLosses(a) - teamLosses(b);
    });
  const top = ranked[0];
  if (!top) return null;
  const wins = teamWins(top);
  const losses = teamLosses(top);
  const data: HypePlayerData = {
    playerName: top.name,
    teamName: `${wins}-${losses} Record`,
    teamLogoUrl: top.logoUrl ?? undefined,
    statLabel: 'Wins',
    statValue: wins,
    secondaryStat: losses > 0 ? { label: 'Losses', value: losses } : undefined,
    playerHref: `#/teams/${top.id}`,
  };
  if (shouldMountWebGL()) {
    return mountHypeCard(host, data, { kicker: '🏆 Team of the Week', accentColor: '#4ea1ff' });
  }
  const card = document.createElement('a');
  card.href = data.playerHref;
  card.style.cssText = 'display:block; padding:0.75rem 1.25rem; border-radius:12px; background:#0e1119; border:2px solid #4ea1ff; text-decoration:none; color:inherit;';
  card.innerHTML = `<span style="color:#4ea1ff;font-weight:700;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;">&#127942; Team of the Week</span>
    <div style="font-size:1.1rem;font-weight:700;color:#e5e7eb;margin-top:0.25rem;">${top.name}</div>
    <div style="font-size:0.8rem;color:#9ca3af;">${wins}-${losses} Record</div>`;
  host.appendChild(card);
  return null;
}

/** @deprecated Use renderPlayerHypeCard with pre-fetched bundle data. */
export async function loadHypeCard(host: HTMLElement, season: string): Promise<HypeCardHandle | null> {
  try {
    const { getPlayerLeaders } = await import('../../api.js');
    const resp = await getPlayerLeaders({ metric: 'goals', limit: 1, minGames: 3, season });
    const top = resp.rows[0];
    if (!top) return null;
    return renderPlayerHypeCard(host, {
      playerId: top.playerId,
      playerName: top.playerName,
      teamId: top.teamId,
      teamName: top.teamName,
      teamLogoUrl: top.teamLogoUrl ?? null,
      goals: top.goals,
      assists: top.assists,
      value: top.value,
    });
  } catch {
    return null;
  }
}

/** @deprecated Use renderTeamHypeCard with pre-fetched bundle data. */
export async function loadTeamHypeCard(host: HTMLElement, season: string): Promise<HypeCardHandle | null> {
  try {
    const { getTeams } = await import('../../api.js');
    const teams = await getTeams({ season });
    return renderTeamHypeCard(host, teams);
  } catch {
    return null;
  }
}

