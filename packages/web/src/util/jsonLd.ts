const JSON_LD_ID = 'pll-json-ld';

export function clearJsonLd(): void {
  document.getElementById(JSON_LD_ID)?.remove();
}

export function injectJsonLd(data: object): void {
  clearJsonLd();
  const script = document.createElement('script');
  script.id = JSON_LD_ID;
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}

export function teamJsonLd(team: { name: string; id: string; record?: string }): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsTeam',
    name: team.name,
    url: `https://phillylaxstats.com/#/teams/${team.id}`,
    sport: 'Lacrosse',
    ...(team.record && { description: `Record: ${team.record}` }),
  };
}

export function playerJsonLd(player: { name: string; id: string; teamName?: string }): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: player.name,
    url: `https://phillylaxstats.com/#/players/${player.id}`,
    ...(player.teamName && { memberOf: { '@type': 'SportsTeam', name: player.teamName } }),
  };
}

export function gameJsonLd(game: {
  id: string;
  homeTeam: string;
  awayTeam: string;
  date: string;
  score?: string;
}): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: `${game.awayTeam} at ${game.homeTeam}`,
    url: `https://phillylaxstats.com/#/games/${game.id}`,
    startDate: game.date,
    ...(game.score && { description: game.score }),
  };
}
