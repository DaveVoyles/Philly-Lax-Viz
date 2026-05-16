import Database from 'better-sqlite3';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAnomalySummary } from '../queries/anomalies.js';
import { getConstellation } from '../queries/constellation.js';
import { synthesizeScoringEvents } from '../queries/games.js';
import {
  PLAYER_METRICS,
  TEAM_METRICS,
  getPlayerLeaders,
  getTeamLeaders,
  type PlayerLeaderRow,
  type PlayerMetric,
  type TeamLeaderRow,
  type TeamMetric,
} from '../queries/leaderboards.js';
import {
  mapAnomaly,
  mapGame,
  mapGamePeriod,
  mapPlayerStat,
  mapRanking,
  mapTeam,
  type AnomalyRow,
  type GamePeriodRow,
  type GameRow,
  type PlayerStatRow,
  type RankingRow,
  type TeamRow,
} from '../queries/mappers.js';
import { getImageForSlug } from '../queries/postImages.js';
import { getRivalryGraph } from '../queries/rivalries.js';
import { groupByDate, listScheduleGames, listUpcomingForTeam } from '../queries/schedule.js';
import { getStatements } from '../queries/statements.js';
import { buildPlayerDetail } from '../routes/players.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'packages', 'web', 'public', 'data');
const DEFAULT_LOGOS_DIR = path.join(REPO_ROOT, 'packages', 'web', 'public', 'logos');
const DB_PATH = path.join(REPO_ROOT, 'data', 'lacrosse.db');
const DEFAULT_SEASON = 2026;
const PLAYER_LEADER_LIMIT = 100;
const TEAM_LEADER_LIMIT = 100;
const SPARKLINE_LIMIT = 25;
const DEFAULT_MIN_ATTEMPTS = 20;
const ANOMALY_SUMMARY_LIMIT = 50;
const SCHEDULE_FROM = '2026-01-01';
const LEADER_SPARKLINE_METRICS = [
  'points',
  'goals',
  'assists',
  'groundBalls',
  'causedTurnovers',
  'saves',
  'faceoffWins',
] as const;
const SPARKLINE_SQL: Record<(typeof LEADER_SPARKLINE_METRICS)[number], string> = {
  points: '(ps.goals + ps.assists)',
  goals: 'ps.goals',
  assists: 'ps.assists',
  groundBalls: 'ps.ground_balls',
  causedTurnovers: 'ps.caused_turnovers',
  saves: 'ps.saves',
  faceoffWins: 'ps.fo_won',
};

interface SearchHit {
  kind: 'player' | 'team';
  id: number;
  name: string;
  teamName?: string;
}

interface PlayerSearchRow {
  id: number;
  name: string;
  team_name: string | null;
}

interface TeamSearchRow {
  id: number;
  name: string;
}

interface TopScorerRow {
  player_id: number;
  player_name: string;
  goals: number;
  assists: number;
}

interface WritableFile {
  path: string;
  data: unknown;
}

function round2(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(value * 100) / 100;
}

function todayIsoDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultMinGames(metric: PlayerMetric): number {
  if (metric === 'points_per_game') return 2;
  if (metric === 'saves') return 3;
  if (metric === 'ground_balls') return 3;
  return 1;
}

function shapePlayerLeader(metric: PlayerMetric, row: PlayerLeaderRow, rank: number) {
  const pointsPerGame = row.points_per_game === null ? null : round2(row.points_per_game);
  const foPct = row.fo_pct === null ? null : round2(row.fo_pct);
  let value: number | null;
  switch (metric) {
    case 'points':
      value = row.points;
      break;
    case 'goals':
      value = row.goals;
      break;
    case 'assists':
      value = row.assists;
      break;
    case 'ground_balls':
      value = row.ground_balls;
      break;
    case 'caused_turnovers':
      value = row.caused_turnovers;
      break;
    case 'saves':
      value = row.saves;
      break;
    case 'fo_pct':
      value = foPct;
      break;
    case 'points_per_game':
      value = pointsPerGame;
      break;
  }
  return {
    rank,
    playerId: row.player_id,
    playerName: row.player_name,
    teamId: row.team_id,
    teamName: row.team_name,
    teamLogoUrl: row.team_logo_url ? `/logos/${row.team_logo_url}` : null,
    teamPrimaryColor: row.team_primary_color,
    gamesPlayed: row.games_played,
    goals: row.goals,
    assists: row.assists,
    points: row.points,
    groundBalls: row.ground_balls,
    causedTurnovers: row.caused_turnovers,
    saves: row.saves,
    foWon: row.fo_won,
    foTaken: row.fo_taken,
    foPct,
    pointsPerGame,
    onFire: row.on_fire === 1,
    value,
  };
}

function shapeTeamLeader(metric: TeamMetric, row: TeamLeaderRow, rank: number) {
  const goalDiff = row.goals_for - row.goals_against;
  const winPct = row.wins + row.losses > 0 ? round2(row.wins / (row.wins + row.losses)) : null;
  const gpg = row.games_played > 0 ? round2(row.goals_for / row.games_played) : null;
  const gapg = row.games_played > 0 ? round2(row.goals_against / row.games_played) : null;
  let value: number | null;
  switch (metric) {
    case 'wins':
      value = row.wins;
      break;
    case 'losses':
      value = row.losses;
      break;
    case 'win_pct':
      value = winPct;
      break;
    case 'goals_for':
      value = row.goals_for;
      break;
    case 'goals_against':
      value = row.goals_against;
      break;
    case 'goal_diff':
      value = goalDiff;
      break;
    case 'gpg':
      value = gpg;
      break;
    case 'gapg':
      value = gapg;
      break;
  }
  return {
    rank,
    teamId: row.team_id,
    teamName: row.team_name,
    logoUrl: row.team_logo_url ? `/logos/${row.team_logo_url}` : null,
    primaryColor: row.team_primary_color,
    gamesPlayed: row.games_played,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    winPct,
    goalsFor: row.goals_for,
    goalsAgainst: row.goals_against,
    goalDiff,
    gpg,
    gapg,
    value,
  };
}

function getLeaderSparklineExport(
  db: Database.Database,
  metric: (typeof LEADER_SPARKLINE_METRICS)[number],
  limit: number,
  season: number,
) {
  const metricExpr = SPARKLINE_SQL[metric];
  const seasonFilter = 'AND ps.season = @season';
  const topSql = `
    SELECT p.id AS player_id,
           p.name AS player_name
    FROM players p
    JOIN player_stats ps ON ps.player_id = p.id
    JOIN games g ON g.id = ps.game_id
    WHERE g.postponed = 0 ${seasonFilter}
    GROUP BY p.id, p.name
    HAVING SUM(${metricExpr}) > 0
    ORDER BY SUM(${metricExpr}) DESC, p.name COLLATE NOCASE ASC
    LIMIT @limit
  `;
  const topRows = db.prepare(topSql).all({ limit, season }) as Array<{
    player_id: number;
    player_name: string;
  }>;
  if (topRows.length === 0) {
    return { metric, season, players: [] as Array<{ player_id: number; name: string; perGame: number[] }> };
  }

  const ids = topRows.map((row) => row.player_id);
  const placeholders = ids.map((_, index) => `@id${index}`).join(',');
  const perGameSql = `
    SELECT ps.player_id AS player_id,
           SUM(${metricExpr}) AS value,
           g.date AS game_date,
           g.id AS game_id
    FROM player_stats ps
    JOIN games g ON g.id = ps.game_id
    WHERE g.postponed = 0
      AND ps.player_id IN (${placeholders})
      ${seasonFilter}
    GROUP BY ps.player_id, ps.game_id, g.date, g.id
    ORDER BY g.date ASC, g.id ASC
  `;
  const perGameParams: Record<string, number> = { season };
  ids.forEach((id, index) => {
    perGameParams[`id${index}`] = id;
  });
  const perGameRows = db.prepare(perGameSql).all(perGameParams) as Array<{
    player_id: number;
    value: number;
  }>;

  const byPlayer = new Map<number, number[]>();
  for (const row of perGameRows) {
    const values = byPlayer.get(row.player_id) ?? [];
    values.push(Number(row.value) || 0);
    byPlayer.set(row.player_id, values);
  }

  return {
    metric,
    season,
    players: topRows.map((row) => ({
      player_id: row.player_id,
      name: row.player_name,
      perGame: byPlayer.get(row.player_id) ?? [],
    })),
  };
}

function resolveOutDir(rawArg: string | undefined): string {
  if (!rawArg) return DEFAULT_OUT_DIR;
  return path.isAbsolute(rawArg) ? rawArg : path.resolve(process.cwd(), rawArg);
}

function main(): void {
  const outDir = resolveOutDir(process.argv[2]);
  const logosDir = path.join(path.dirname(outDir), 'logos');
  const db = new Database(DB_PATH, { readonly: true });
  const s = getStatements(db);
  const seasonDir = path.join(outDir, String(DEFAULT_SEASON));
  const files: WritableFile[] = [];
  const addFile = (relativePath: string, data: unknown) => {
    files.push({ path: path.join(outDir, relativePath), data });
  };

  const count = (stmt: import('better-sqlite3').Statement): number => {
    const row = stmt.get() as { c: number };
    return row.c;
  };

  const health = {
    ok: true,
    dbRows: {
      teams: count(s.countTeams),
      games: count(s.countGames),
      players: count(s.countPlayers),
      playerStats: count(s.countPlayerStats),
      rankings: count(s.countRankings),
      anomalies: count(s.countAnomalies),
    },
  };
  addFile('health.json', health);
  addFile('seasons.json', { seasons: [DEFAULT_SEASON], default: DEFAULT_SEASON });
  addFile('empty.json', []);

  const teamRows = s.listTeams.all() as TeamRow[];
  const teams = teamRows.map(mapTeam);
  addFile(`${DEFAULT_SEASON}/teams.json`, teams);

  const seasonGameRows = db
    .prepare('SELECT * FROM games WHERE season = ? ORDER BY date DESC, id DESC')
    .all(DEFAULT_SEASON) as GameRow[];
  const seasonGames = seasonGameRows.map(mapGame);
  addFile(`${DEFAULT_SEASON}/games.json`, seasonGames);

  for (const teamRow of teamRows) {
    const team = mapTeam(teamRow);
    const gameRows = db
      .prepare(
        'SELECT * FROM games WHERE season = ? AND (home_team_id = ? OR away_team_id = ?) ORDER BY date DESC, id DESC',
      )
      .all(DEFAULT_SEASON, team.id, team.id) as GameRow[];
    const games = gameRows.map(mapGame);

    let wins = 0;
    let losses = 0;
    let ties = 0;
    for (const game of games) {
      if (game.postponed) continue;
      const isHome = game.homeTeamId === team.id;
      const myScore = isHome ? game.homeScore : game.awayScore;
      const theirScore = isHome ? game.awayScore : game.homeScore;
      if (myScore > theirScore) wins += 1;
      else if (myScore < theirScore) losses += 1;
      else ties += 1;
    }

    const derivedRecord = { wins, losses, ties };
    const record = team.piaa
      ? { wins: team.piaa.wins, losses: team.piaa.losses, ties: team.piaa.ties }
      : derivedRecord;
    const rankRow = s.latestRankingForTeam.get(team.id) as { rank: number } | undefined;
    const topScorerRows = s.topScorersForTeam.all(team.id, 10) as TopScorerRow[];
    const topScorers = topScorerRows.map((row) => ({
      playerId: row.player_id,
      playerName: row.player_name,
      goals: row.goals,
      assists: row.assists,
    }));

    addFile(`${DEFAULT_SEASON}/teams/${team.id}.json`, {
      team,
      games,
      record,
      derivedRecord,
      recordSource: team.piaa ? 'piaa' : 'phillylacrosse',
      recentRanking: rankRow?.rank ?? null,
      topScorers,
    });
  }

  for (const gameRow of seasonGameRows) {
    const periods = (s.periodsForGame.all(gameRow.id) as GamePeriodRow[]).map(mapGamePeriod);
    type StatJoinRow = PlayerStatRow & { player_name: string; team_name: string };
    const statRows = s.playerStatsForGame.all(gameRow.id) as StatJoinRow[];
    const playerStats = statRows.map((row) => ({
      ...mapPlayerStat(row),
      playerName: row.player_name,
      teamName: row.team_name,
    }));
    const homeTeamRow = s.getTeamById.get(gameRow.home_team_id) as TeamRow | undefined;
    const awayTeamRow = s.getTeamById.get(gameRow.away_team_id) as TeamRow | undefined;
    const playerTeamIdByPlayerId = new Map<number, number>();
    for (const row of statRows) {
      if (row.team_name === homeTeamRow?.name) playerTeamIdByPlayerId.set(row.player_id, gameRow.home_team_id);
      else if (row.team_name === awayTeamRow?.name) playerTeamIdByPlayerId.set(row.player_id, gameRow.away_team_id);
    }
    const scoringEvents = synthesizeScoringEvents(
      periods,
      playerStats.map((stat) => ({
        ...stat,
        teamId: playerTeamIdByPlayerId.get(stat.playerId) ?? -1,
      })),
      gameRow.home_team_id,
      gameRow.away_team_id,
    );
    const game = mapGame(gameRow);
    game.imageUrl = gameRow.source_post_id ? getImageForSlug(db, gameRow.source_post_id)?.image_url ?? null : null;

    addFile(`${DEFAULT_SEASON}/games/${game.id}.json`, {
      game,
      homeTeam: homeTeamRow ? mapTeam(homeTeamRow) : null,
      awayTeam: awayTeamRow ? mapTeam(awayTeamRow) : null,
      periods,
      playerStats,
      scoringEvents,
      scoringEventsHeuristic:
        'Made from team scores by quarter (game_periods) and per-game player goal/assist totals (player_stats); no per-goal timestamps in source.',
    });
  }

  const playerRows = db.prepare('SELECT id FROM players ORDER BY id ASC').all() as Array<{ id: number }>;
  for (const playerRow of playerRows) {
    const detail = buildPlayerDetail(db, playerRow.id);
    if (detail) addFile(`${DEFAULT_SEASON}/players/${playerRow.id}.json`, detail);
  }

  const latestRankingWeek = s.latestRankingWeekAnySource.get() as { week_start: string } | undefined;
  const rankings = latestRankingWeek
    ? (s.rankingsForWeekAnySource.all(latestRankingWeek.week_start) as RankingRow[]).map((row) => {
        const teamRow = s.getTeamById.get(row.team_id) as TeamRow | undefined;
        return {
          ...mapRanking(row),
          team: teamRow ? mapTeam(teamRow) : null,
        };
      })
    : [];
  addFile(`${DEFAULT_SEASON}/rankings.json`, rankings);

  for (const metric of PLAYER_METRICS) {
    const minGames = defaultMinGames(metric);
    const rows = getPlayerLeaders(db, {
      metric,
      limit: PLAYER_LEADER_LIMIT,
      minGames,
      minAttempts: DEFAULT_MIN_ATTEMPTS,
      season: DEFAULT_SEASON,
    });
    addFile(`${DEFAULT_SEASON}/leaders/players/${metric}.json`, {
      metric,
      minGames,
      season: DEFAULT_SEASON,
      rows: rows.map((row, index) => shapePlayerLeader(metric, row, index + 1)),
    });
  }

  for (const metric of TEAM_METRICS) {
    const rows = getTeamLeaders(db, {
      metric,
      limit: TEAM_LEADER_LIMIT,
      season: DEFAULT_SEASON,
    });
    addFile(`${DEFAULT_SEASON}/leaders/teams/${metric}.json`, {
      metric,
      season: DEFAULT_SEASON,
      rows: rows.map((row, index) => shapeTeamLeader(metric, row, index + 1)),
    });
  }

  for (const metric of LEADER_SPARKLINE_METRICS) {
    addFile(
      `${DEFAULT_SEASON}/leaders/sparklines/${metric}.json`,
      getLeaderSparklineExport(db, metric, SPARKLINE_LIMIT, DEFAULT_SEASON),
    );
  }

  addFile(`${DEFAULT_SEASON}/rivalries.json`, getRivalryGraph(db));
  addFile(`${DEFAULT_SEASON}/constellation.json`, {
    season: DEFAULT_SEASON,
    players: getConstellation(db, { season: DEFAULT_SEASON }),
  });

  const anomalyRows = db
    .prepare('SELECT * FROM ingest_anomalies ORDER BY created_at DESC, id DESC')
    .all() as AnomalyRow[];
  addFile(`${DEFAULT_SEASON}/anomalies.json`, anomalyRows.map(mapAnomaly));
  addFile(
    `${DEFAULT_SEASON}/anomalies-summary.json`,
    getAnomalySummary(db, { limit: ANOMALY_SUMMARY_LIMIT }),
  );

  const scheduleRows = listScheduleGames(db, {
    season: DEFAULT_SEASON,
    from: SCHEDULE_FROM,
    limit: 5000,
  });
  addFile(`${DEFAULT_SEASON}/schedule.json`, {
    from: SCHEDULE_FROM,
    to: null,
    season: DEFAULT_SEASON,
    total: scheduleRows.length,
    byDate: groupByDate(scheduleRows),
  });

  const today = todayIsoDate();
  for (const team of teams) {
    const upcomingGames = listUpcomingForTeam(db, team.id, today, 5);
    const fallbackGames =
      upcomingGames.length > 0
        ? upcomingGames
        : listScheduleGames(db, {
            season: DEFAULT_SEASON,
            from: SCHEDULE_FROM,
            teamId: team.id,
            limit: 500,
          });
    addFile(`${DEFAULT_SEASON}/schedule/team/${team.id}.json`, {
      teamId: team.id,
      from: today,
      games: fallbackGames,
    });
  }

  const playerSearchRows = db.prepare(
    'SELECT p.id, p.name, t.name AS team_name FROM players p LEFT JOIN teams t ON t.id = p.team_id ORDER BY LOWER(p.name) ASC',
  ).all() as PlayerSearchRow[];
  const teamSearchRows = db.prepare('SELECT id, name FROM teams ORDER BY LOWER(name) ASC').all() as TeamSearchRow[];
  const searchIndex: SearchHit[] = [
    ...teamSearchRows.map((row) => ({ kind: 'team' as const, id: row.id, name: row.name })),
    ...playerSearchRows.map((row) => ({
      kind: 'player' as const,
      id: row.id,
      name: row.name,
      ...(row.team_name ? { teamName: row.team_name } : {}),
    })),
  ];
  addFile(`${DEFAULT_SEASON}/search-index.json`, searchIndex);

  if (existsSync(path.join(REPO_ROOT, 'data', 'logos'))) {
    mkdirSync(logosDir, { recursive: true });
    cpSync(path.join(REPO_ROOT, 'data', 'logos'), logosDir, { recursive: true });
  }

  console.log(`[export] writing ${files.length} files...`);
  for (const file of files) {
    mkdirSync(path.dirname(file.path), { recursive: true });
    writeFileSync(file.path, JSON.stringify(file.data, null, 2));
  }
  db.close();
}

main();
