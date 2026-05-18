import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { createLogger } from '@pll/shared';
import { openDb } from '../db.js';
import { normalizePlayerName } from '../normalize/playerName.js';
import { checkServerProcs } from './lib/checkServerProcs.js';

const log = createLogger({ name: 'ingest:applyHarritonWorkbook' });

const DEFAULT_TEAM_NAME = 'Harriton';
const DEFAULT_SEASON = 2026;
const IMPORT_SOURCE = 'parent-workbook';
const IMPORT_PARSER_VERSION = 'harriton-workbook-v1';
const PLAYER_ALIAS_SOURCE = 'parent-workbook-harriton-v1';
const SHEET_OPPONENT_OVERRIDES: Record<string, string> = {
  phoenix: 'phoenixville',
  cardinalo: 'cardinalohara',
  newhopes: 'newhopesolebury',
  lm: 'lowermerion',
  ud: 'upperdarby',
  haven: 'strathhaven',
  mn: 'marplenewtown',
  stoga: 'conestoga',
  gv: 'garnetvalley',
  cbsouth: 'cbsouth',
  ford: 'haverford',
  uppermerion: 'uppermerion',
};

type Scalar = string | number | null;
type RowValue = Record<string, Scalar>;

interface WorkbookSheet {
  name: string;
  rows: RowValue[];
}

interface WorkbookDump {
  sheets: WorkbookSheet[];
}

interface ScriptArgs {
  workbookPath: string;
  dbPath: string;
  apply: boolean;
  force: boolean;
  teamName: string;
  season: number;
}

export interface OpponentGame {
  gameId: number;
  date: string;
  season: number;
}

export interface OpponentGroup {
  opponentTeamId: number;
  opponentName: string;
  games: OpponentGame[];
  tokens: Set<string>;
}

interface SheetMapping {
  sheetName: string;
  gameId: number;
  season: number;
  opponentName: string;
  confidence: number;
}

interface SkippedSheet {
  sheetName: string;
  reason: string;
}

interface ParsedStatLine {
  playerRawName: string;
  goals: number;
  assists: number;
  groundBalls: number;
  causedTurnovers: number;
  saves: number;
  foWon: number;
  foTaken: number;
}

export interface PlayerSeed {
  id: number;
  name: string;
  normalized: string;
  firstInitial: string;
  lastToken: string;
  statRows: number;
}

export interface PlayerAliasWrite {
  alias: string;
  playerId: number;
  confidence: number;
}

export interface PlayerCreate {
  syntheticId: number;
  name: string;
  normalized: string;
}

interface PlayerCreateDraft {
  name: string;
  normalized: string;
}

export interface PlayerResolution {
  kind: 'existing' | 'alias' | 'created' | 'skipped';
  playerId?: number;
  aliasWrite?: PlayerAliasWrite;
  create?: PlayerCreateDraft;
  reason?: string;
}

interface GameStatWrite {
  gameId: number;
  season: number;
  playerId: number;
  goals: number;
  assists: number;
  groundBalls: number;
  causedTurnovers: number;
  saves: number;
  foWon: number;
  foTaken: number;
}

interface ImportPlan {
  mappedSheets: SheetMapping[];
  skippedSheets: SkippedSheet[];
  stats: GameStatWrite[];
  createdPlayers: PlayerCreate[];
  aliasWrites: PlayerAliasWrite[];
  skippedPlayers: Array<{ sheetName: string; playerName: string; reason: string }>;
}

interface TeamContext {
  teamId: number;
  opponents: OpponentGroup[];
  players: PlayerSeed[];
}

export function normalizeWorkbookToken(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function toWords(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function toInitials(words: string[]): string {
  if (words.length <= 1) return '';
  return words.map((word) => word[0] ?? '').join('');
}

function buildOpponentTokens(name: string, slug: string, aliases: string[]): Set<string> {
  const out = new Set<string>();
  const pushText = (value: string): void => {
    const token = normalizeWorkbookToken(value);
    if (token) out.add(token);
  };
  const pushWords = (value: string): void => {
    const words = toWords(value);
    if (words.length === 0) return;
    out.add(words.join(''));
    const initials = toInitials(words);
    if (initials) out.add(initials);
    if (words.length > 1) {
      const prefix = words.slice(0, -1).map((word) => word[0] ?? '').join('');
      out.add(`${prefix}${words[words.length - 1] ?? ''}`);
    }
    out.add(words[0] ?? '');
    out.add(words[words.length - 1] ?? '');
  };

  pushText(name);
  pushText(slug);
  pushWords(name);
  pushWords(slug);
  for (const alias of aliases) {
    pushText(alias);
    pushWords(alias);
  }
  return out;
}

function scoreTokenMatch(sheetToken: string, candidate: string): number {
  if (!sheetToken || !candidate) return 0;
  if (sheetToken === candidate) return 100;
  if (candidate.startsWith(sheetToken) || sheetToken.startsWith(candidate)) return 82;
  if (candidate.includes(sheetToken) || sheetToken.includes(candidate)) return 64;
  return 0;
}

export function pickOpponentGroupForSheet(
  sheetName: string,
  groups: OpponentGroup[],
): { group?: OpponentGroup; confidence: number; reason?: string } {
  const token = normalizeWorkbookToken(sheetName);
  if (!token) return { confidence: 0, reason: 'empty token' };

  const overrideToken = SHEET_OPPONENT_OVERRIDES[token];
  if (overrideToken) {
    const matched = groups.filter((group) => Array.from(group.tokens).some((candidate) => candidate.includes(overrideToken)));
    if (matched.length === 1) {
      const group = matched[0]!;
      if (group.games.length !== 1) {
        return { confidence: 1, reason: 'opponent has multiple games in season' };
      }
      return { group, confidence: 1 };
    }
    if (matched.length > 1) return { confidence: 1, reason: 'override matched multiple opponents' };
  }

  const scored = groups
    .map((group) => ({
      group,
      score: Math.max(...Array.from(group.tokens).map((candidate) => scoreTokenMatch(token, candidate))),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { confidence: 0, reason: 'no opponent token match' };
  const best = scored[0]!;
  if (best.score < 75) return { confidence: best.score / 100, reason: `low confidence token score ${best.score}` };
  const ties = scored.filter((row) => row.score === best.score);
  if (ties.length > 1) return { confidence: best.score / 100, reason: 'ambiguous opponent token match' };
  if (best.group.games.length !== 1) {
    return { confidence: best.score / 100, reason: 'opponent has multiple games in season' };
  }
  return { group: best.group, confidence: best.score / 100 };
}

function lastToken(normalizedName: string): string {
  const parts = normalizedName.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function firstInitial(normalizedName: string): string {
  const parts = normalizedName.split(/\s+/).filter(Boolean);
  return parts[0]?.[0] ?? '';
}

function pickCanonicalByStats(candidates: PlayerSeed[]): PlayerSeed[] {
  if (candidates.length <= 1) return candidates;
  const sorted = [...candidates].sort((a, b) => {
    if (b.statRows !== a.statRows) return b.statRows - a.statRows;
    return a.id - b.id;
  });
  const first = sorted[0]!;
  const second = sorted[1]!;
  if (first.statRows > second.statRows) return [first];
  return candidates;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i]![0] = i;
  for (let j = 0; j < cols; j += 1) dp[0]![j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[rows - 1]![cols - 1]!;
}

export function resolvePlayerName(
  rawName: string,
  players: PlayerSeed[],
): PlayerResolution {
  const normalized = normalizePlayerName(rawName);
  if (!normalized) return { kind: 'skipped', reason: 'empty normalized player name' };

  const exact = players.filter((player) => player.normalized === normalized);
  if (exact.length === 1) return { kind: 'existing', playerId: exact[0]!.id };

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    const token = words[0]!;
    const byLastName = pickCanonicalByStats(
      players.filter((player) => levenshtein(token, player.lastToken) <= 1),
    );
    if (byLastName.length === 1) {
      const target = byLastName[0]!;
      return {
        kind: 'alias',
        playerId: target.id,
        aliasWrite: { alias: normalized, playerId: target.id, confidence: 0.91 },
      };
    }
    if (byLastName.length > 1) {
      return { kind: 'skipped', reason: 'single-token player matched multiple last names' };
    }
    const nearestLastToken = players
      .map((player) => levenshtein(token, player.lastToken))
      .sort((a, b) => a - b)[0];
    if (nearestLastToken !== undefined && nearestLastToken <= 2) {
      return { kind: 'skipped', reason: 'single-token player too close to existing roster name' };
    }
    return { kind: 'created', create: { name: rawName.trim(), normalized } };
  }

  const targetLast = lastToken(normalized);
  const targetInitial = firstInitial(normalized);
  const byLastAndInitial = pickCanonicalByStats(
    players.filter(
      (player) => player.lastToken === targetLast && player.firstInitial === targetInitial,
    ),
  );
  if (byLastAndInitial.length === 1) {
    const target = byLastAndInitial[0]!;
    return {
      kind: 'alias',
      playerId: target.id,
      aliasWrite: { alias: normalized, playerId: target.id, confidence: 0.94 },
    };
  }
  if (byLastAndInitial.length > 1) {
    return { kind: 'skipped', reason: 'name matched multiple players by last name + initial' };
  }

  const fuzzy = players
    .map((player) => ({ player, dist: levenshtein(normalized, player.normalized) }))
    .filter((row) => row.dist <= 2)
    .sort((a, b) => a.dist - b.dist);
  if (fuzzy.length === 1) {
    const target = fuzzy[0]!.player;
    return {
      kind: 'alias',
      playerId: target.id,
      aliasWrite: { alias: normalized, playerId: target.id, confidence: 0.9 },
    };
  }
  if (fuzzy.length > 1 && fuzzy[0]!.dist === fuzzy[1]!.dist) {
    return { kind: 'skipped', reason: 'fuzzy name matched multiple players equally' };
  }

  const nearest = players
    .map((player) => levenshtein(normalized, player.normalized))
    .sort((a, b) => a - b)[0];
  if (nearest !== undefined && nearest <= 3) {
    return { kind: 'skipped', reason: 'candidate looked close to existing player but not unique' };
  }

  return { kind: 'created', create: { name: rawName.trim(), normalized } };
}

function parseNumeric(raw: Scalar): number {
  if (raw === null) return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.trunc(raw));
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    const parsed = Number.parseFloat(trimmed);
    if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
  }
  return 0;
}

export function parseFaceoff(raw: Scalar): { won: number; taken: number } {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(trimmed);
    if (m) {
      return { won: Number.parseInt(m[1]!, 10), taken: Number.parseInt(m[2]!, 10) };
    }
  }
  return { won: parseNumeric(raw), taken: 0 };
}

function lookupValue(row: RowValue, keys: string[]): Scalar {
  const normalizedKeys = new Set(keys.map((key) => normalizeWorkbookToken(key)));
  for (const [key, value] of Object.entries(row)) {
    if (normalizedKeys.has(normalizeWorkbookToken(key))) return value;
  }
  return null;
}

function parseStatLine(row: RowValue): ParsedStatLine | null {
  const playerRaw = lookupValue(row, ['player', 'name']);
  const playerRawName = typeof playerRaw === 'string' ? playerRaw.trim() : String(playerRaw ?? '').trim();
  if (!playerRawName) return null;
  const fo = parseFaceoff(lookupValue(row, ['fo', 'faceoff', 'faceoffs']));
  const line: ParsedStatLine = {
    playerRawName,
    goals: parseNumeric(lookupValue(row, ['goals', 'g'])),
    assists: parseNumeric(lookupValue(row, ['assists', 'a'])),
    groundBalls: parseNumeric(lookupValue(row, ['gbs', 'groundballs', 'ground_balls', 'gb'])),
    causedTurnovers: parseNumeric(lookupValue(row, ['cts', 'causedturnovers', 'caused_turnovers', 'ct'])),
    saves: parseNumeric(lookupValue(row, ['saves', 'sv'])),
    foWon: fo.won,
    foTaken: fo.taken,
  };
  const total =
    line.goals +
    line.assists +
    line.groundBalls +
    line.causedTurnovers +
    line.saves +
    line.foWon +
    line.foTaken;
  return total > 0 ? line : null;
}

function parseArgs(argv: string[]): ScriptArgs {
  const args = new Map<string, string>();
  for (const part of argv) {
    if (part.startsWith('--') && part.includes('=')) {
      const [k, v] = part.split('=', 2);
      if (!k) continue;
      args.set(k, v ?? '');
    }
  }
  const workbookPath = args.get('--workbook');
  if (!workbookPath) {
    throw new Error('Missing required --workbook=<path> argument');
  }
  const dbPath = args.get('--db') ?? 'data/lacrosse.db';
  const seasonRaw = Number.parseInt(args.get('--season') ?? String(DEFAULT_SEASON), 10);
  return {
    workbookPath,
    dbPath,
    apply: argv.includes('--apply'),
    force: argv.includes('--force'),
    teamName: args.get('--team') ?? DEFAULT_TEAM_NAME,
    season: Number.isInteger(seasonRaw) ? seasonRaw : DEFAULT_SEASON,
  };
}

function resolvePath(inputPath: string): string {
  if (inputPath.startsWith('/')) return inputPath;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', inputPath);
}

function readWorkbook(workbookPath: string): WorkbookDump {
  const python = `
import json
import sys
import zipfile
import xml.etree.ElementTree as ET

path = sys.argv[1]
NS_MAIN = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
NS_REL = '{http://schemas.openxmlformats.org/package/2006/relationships}'
NS_DOC_REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'

def col_ref(cell_ref):
    out = ''
    for ch in cell_ref:
        if 'A' <= ch <= 'Z':
            out += ch
        else:
            break
    return out

def col_index(col):
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - ord('A') + 1)
    return n

with zipfile.ZipFile(path) as z:
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rel_map = {}
    for rel in rels:
        rid = rel.attrib.get('Id')
        target = rel.attrib.get('Target')
        if rid and target:
            rel_map[rid] = target

    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        sst = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in sst.findall(f'.//{NS_MAIN}si'):
            txt = ''.join((t.text or '') for t in si.findall(f'.//{NS_MAIN}t'))
            shared.append(txt)

    sheets = []
    for sh in wb.findall(f'.//{NS_MAIN}sheets/{NS_MAIN}sheet'):
        name = sh.attrib.get('name', '')
        rid = sh.attrib.get(f'{NS_DOC_REL}id')
        target = rel_map.get(rid, '')
        if not target:
            continue
        sheet_path = target if target.startswith('xl/') else 'xl/' + target
        ws = ET.fromstring(z.read(sheet_path))
        rows = []
        for row in ws.findall(f'.//{NS_MAIN}sheetData/{NS_MAIN}row'):
            values = {}
            for cell in row.findall(f'{NS_MAIN}c'):
                ref = cell.attrib.get('r', '')
                col = col_ref(ref)
                t = cell.attrib.get('t')
                v = cell.find(f'{NS_MAIN}v')
                if v is None or v.text is None:
                    continue
                raw = v.text
                val = raw
                if t == 's' and raw.isdigit():
                    idx = int(raw)
                    val = shared[idx] if 0 <= idx < len(shared) else raw
                else:
                    try:
                        if '.' in raw:
                            val = float(raw)
                        else:
                            val = int(raw)
                    except Exception:
                        val = raw
                values[col] = val
            rows.append(values)

        if not rows:
            sheets.append({'name': name, 'rows': []})
            continue

        header_row = rows[0]
        header_pairs = sorted(
            ((col_index(k), str(v).strip()) for k, v in header_row.items()),
            key=lambda x: x[0]
        )
        headers = [h for _, h in header_pairs if h]
        header_cols = [idx for idx, h in header_pairs if h]

        data_rows = []
        for raw_row in rows[1:]:
            obj = {}
            for idx, header in zip(header_cols, headers):
                col = ''
                n = idx
                while n > 0:
                    n, rem = divmod(n - 1, 26)
                    col = chr(ord('A') + rem) + col
                if col in raw_row:
                    obj[header] = raw_row[col]
                else:
                    obj[header] = None
            if any(v not in (None, '') for v in obj.values()):
                data_rows.append(obj)
        sheets.append({'name': name, 'rows': data_rows})

    print(json.dumps({'sheets': sheets}))
`;
  const out = spawnSync('python3', ['-c', python, workbookPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (out.status !== 0) {
    throw new Error(`Failed to parse workbook via python3: ${out.stderr || 'unknown error'}`);
  }
  const parsed = JSON.parse(out.stdout) as WorkbookDump;
  if (!parsed || !Array.isArray(parsed.sheets)) {
    throw new Error('Workbook parse returned invalid JSON shape');
  }
  return parsed;
}

function loadTeamContext(db: Database, teamName: string, season: number): TeamContext {
  const team = db
    .prepare('SELECT id FROM teams WHERE LOWER(name) = LOWER(?)')
    .get(teamName) as { id: number } | undefined;
  if (!team) throw new Error(`Team not found: ${teamName}`);

  const games = db.prepare(
    `SELECT g.id,
            g.date,
            g.season,
            CASE WHEN g.home_team_id = ? THEN g.away_team_id ELSE g.home_team_id END AS opponent_team_id,
            t.name AS opponent_name,
            t.slug AS opponent_slug
       FROM games g
       JOIN teams t ON t.id = CASE WHEN g.home_team_id = ? THEN g.away_team_id ELSE g.home_team_id END
      WHERE (g.home_team_id = ? OR g.away_team_id = ?)
        AND g.season = ?
      ORDER BY g.date ASC, g.id ASC`,
  ).all(team.id, team.id, team.id, team.id, season) as Array<{
    id: number;
    date: string;
    season: number;
    opponent_team_id: number;
    opponent_name: string;
    opponent_slug: string;
  }>;

  const aliasRows = db.prepare('SELECT team_id, alias FROM team_aliases').all() as Array<{
    team_id: number;
    alias: string;
  }>;
  const aliasesByTeam = new Map<number, string[]>();
  for (const row of aliasRows) {
    const list = aliasesByTeam.get(row.team_id) ?? [];
    list.push(row.alias);
    aliasesByTeam.set(row.team_id, list);
  }

  const byOpponent = new Map<number, OpponentGroup>();
  for (const game of games) {
    const existing = byOpponent.get(game.opponent_team_id);
    if (existing) {
      existing.games.push({ gameId: game.id, date: game.date, season: game.season });
      continue;
    }
    byOpponent.set(game.opponent_team_id, {
      opponentTeamId: game.opponent_team_id,
      opponentName: game.opponent_name,
      games: [{ gameId: game.id, date: game.date, season: game.season }],
      tokens: buildOpponentTokens(
        game.opponent_name,
        game.opponent_slug,
        aliasesByTeam.get(game.opponent_team_id) ?? [],
      ),
    });
  }

  const players = db.prepare(
    `SELECT id, name, name_normalized
       FROM players
      WHERE team_id = ?
      ORDER BY id ASC`,
  ).all(team.id) as Array<{ id: number; name: string; name_normalized: string }>;
  const playerSeeds: PlayerSeed[] = players.map((row) => ({
    id: row.id,
    name: row.name,
    normalized: row.name_normalized,
    firstInitial: firstInitial(row.name_normalized),
    lastToken: lastToken(row.name_normalized),
    statRows: 0,
  }));
  const statCounts = db.prepare(
    `SELECT p.id AS player_id, COUNT(ps.id) AS stat_rows
       FROM players p
       LEFT JOIN player_stats ps ON ps.player_id = p.id
      WHERE p.team_id = ?
      GROUP BY p.id`,
  ).all(team.id) as Array<{ player_id: number; stat_rows: number }>;
  const statCountByPlayer = new Map<number, number>(
    statCounts.map((row) => [row.player_id, row.stat_rows]),
  );
  for (const seed of playerSeeds) {
    seed.statRows = statCountByPlayer.get(seed.id) ?? 0;
  }

  return {
    teamId: team.id,
    opponents: Array.from(byOpponent.values()),
    players: playerSeeds,
  };
}

function aggregateStatLines(lines: Array<{ playerId: number; line: ParsedStatLine }>): Map<number, ParsedStatLine> {
  const out = new Map<number, ParsedStatLine>();
  for (const item of lines) {
    const current = out.get(item.playerId);
    if (!current) {
      out.set(item.playerId, { ...item.line });
      continue;
    }
    current.goals += item.line.goals;
    current.assists += item.line.assists;
    current.groundBalls += item.line.groundBalls;
    current.causedTurnovers += item.line.causedTurnovers;
    current.saves += item.line.saves;
    current.foWon += item.line.foWon;
    current.foTaken += item.line.foTaken;
  }
  return out;
}

export function buildImportPlan(dump: WorkbookDump, context: TeamContext): ImportPlan {
  const mappedSheets: SheetMapping[] = [];
  const skippedSheets: SkippedSheet[] = [];
  const skippedPlayers: Array<{ sheetName: string; playerName: string; reason: string }> = [];
  const aliasWrites: PlayerAliasWrite[] = [];
  const createdPlayers: PlayerCreate[] = [];
  const stats: GameStatWrite[] = [];

  const sheetRowsByGame = new Map<number, Array<{ playerId: number; line: ParsedStatLine; season: number }>>();
  const playerState: PlayerSeed[] = [...context.players];
  let nextSyntheticPlayerId = -1;

  for (const sheet of dump.sheets) {
    if (normalizeWorkbookToken(sheet.name) === 'totals') continue;
    const pick = pickOpponentGroupForSheet(sheet.name, context.opponents);
    if (!pick.group) {
      skippedSheets.push({ sheetName: sheet.name, reason: pick.reason ?? 'unable to map sheet to opponent' });
      continue;
    }

    const game = pick.group.games[0]!;
    mappedSheets.push({
      sheetName: sheet.name,
      gameId: game.gameId,
      season: game.season,
      opponentName: pick.group.opponentName,
      confidence: pick.confidence,
    });

    const resolvedRows: Array<{ playerId: number; line: ParsedStatLine; season: number }> = [];
    for (const row of sheet.rows) {
      const line = parseStatLine(row);
      if (!line) continue;
      const resolution = resolvePlayerName(line.playerRawName, playerState);
      if (resolution.kind === 'skipped') {
        skippedPlayers.push({
          sheetName: sheet.name,
          playerName: line.playerRawName,
          reason: resolution.reason ?? 'unmatched player',
        });
        continue;
      }
      if (resolution.kind === 'created') {
        const create: PlayerCreate = {
          syntheticId: nextSyntheticPlayerId,
          ...resolution.create!,
        };
        createdPlayers.push(create);
        const synthetic = {
          id: create.syntheticId,
          name: create.name,
          normalized: create.normalized,
          firstInitial: firstInitial(create.normalized),
          lastToken: lastToken(create.normalized),
          statRows: 0,
        };
        nextSyntheticPlayerId -= 1;
        playerState.push(synthetic);
        resolvedRows.push({ playerId: synthetic.id, line, season: game.season });
        continue;
      }
      if (resolution.kind === 'alias' && resolution.aliasWrite) {
        aliasWrites.push(resolution.aliasWrite);
      }
      resolvedRows.push({ playerId: resolution.playerId!, line, season: game.season });
    }

    const merged = aggregateStatLines(resolvedRows.map((row) => ({ playerId: row.playerId, line: row.line })));
    const collapsedRows = Array.from(merged.entries()).map(([playerId, line]) => ({
      playerId,
      line,
      season: game.season,
    }));
    sheetRowsByGame.set(game.gameId, collapsedRows);
  }

  for (const [gameId, rows] of sheetRowsByGame) {
    for (const row of rows) {
      stats.push({
        gameId,
        season: row.season,
        playerId: row.playerId,
        goals: row.line.goals,
        assists: row.line.assists,
        groundBalls: row.line.groundBalls,
        causedTurnovers: row.line.causedTurnovers,
        saves: row.line.saves,
        foWon: row.line.foWon,
        foTaken: row.line.foTaken,
      });
    }
  }

  return { mappedSheets, skippedSheets, stats, createdPlayers, aliasWrites, skippedPlayers };
}

function applyPlan(db: Database, teamId: number, plan: ImportPlan): void {
  const insertPlayer = db.prepare(
    `INSERT INTO players (name, name_normalized, team_id, name_resolution)
     VALUES (?, ?, ?, 'full')`,
  );
  const insertAlias = db.prepare(
    `INSERT OR IGNORE INTO player_aliases (alias, player_id, source, confidence)
     VALUES (?, ?, ?, ?)`,
  );
  const deleteStats = db.prepare(
    `DELETE FROM player_stats
      WHERE game_id = ?
        AND player_id IN (SELECT id FROM players WHERE team_id = ?)`,
  );
  const insertStats = db.prepare(
    `INSERT INTO player_stats (
       game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves,
       fo_won, fo_taken, source, parser_version, confidence, season
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0, ?)`,
  );
  const tx = db.transaction(() => {
    const createdIdBySynthetic = new Map<number, number>();
    for (const create of plan.createdPlayers) {
      const result = insertPlayer.run(create.name, create.normalized, teamId);
      createdIdBySynthetic.set(create.syntheticId, Number(result.lastInsertRowid));
    }

    const remapPlayerId = (playerId: number): number => {
      if (playerId > 0) return playerId;
      const mapped = createdIdBySynthetic.get(playerId);
      if (!mapped) throw new Error(`Newly created player missing id for ${playerId}`);
      return mapped;
    };

    for (const alias of plan.aliasWrites) {
      const playerId = alias.playerId > 0 ? alias.playerId : remapPlayerId(alias.playerId);
      insertAlias.run(alias.alias, playerId, PLAYER_ALIAS_SOURCE, alias.confidence);
    }

    const gameIds = [...new Set(plan.stats.map((row) => row.gameId))];
    for (const gameId of gameIds) deleteStats.run(gameId, teamId);

    for (const row of plan.stats) {
      const playerId = row.playerId > 0 ? row.playerId : remapPlayerId(row.playerId);
      insertStats.run(
        row.gameId,
        playerId,
        row.goals,
        row.assists,
        row.groundBalls,
        row.causedTurnovers,
        row.saves,
        row.foWon,
        row.foTaken,
        IMPORT_SOURCE,
        IMPORT_PARSER_VERSION,
        row.season,
      );
    }
  });
  tx();
}

function printPlan(plan: ImportPlan): void {
  log.info(`Mapped sheets: ${plan.mappedSheets.length}`);
  for (const mapped of plan.mappedSheets) {
    log.info(
      `  [mapped] ${mapped.sheetName} -> game ${mapped.gameId} vs ${mapped.opponentName} ` +
        `(confidence=${mapped.confidence.toFixed(2)})`,
    );
  }
  if (plan.skippedSheets.length > 0) {
    log.warn(`Skipped sheets: ${plan.skippedSheets.length}`);
    for (const skipped of plan.skippedSheets) {
      log.warn(`  [skip-sheet] ${skipped.sheetName}: ${skipped.reason}`);
    }
  }
  if (plan.skippedPlayers.length > 0) {
    log.warn(`Skipped player rows: ${plan.skippedPlayers.length}`);
    for (const skipped of plan.skippedPlayers.slice(0, 50)) {
      log.warn(`  [skip-player] ${skipped.sheetName}: ${skipped.playerName} (${skipped.reason})`);
    }
  }
  log.info(`Planned stat rows: ${plan.stats.length}`);
  log.info(`Planned player creates: ${plan.createdPlayers.length}`);
  log.info(`Planned alias writes: ${plan.aliasWrites.length}`);
}

function dedupeAliasWrites(rows: PlayerAliasWrite[]): PlayerAliasWrite[] {
  const map = new Map<string, PlayerAliasWrite>();
  for (const row of rows) {
    const key = `${row.alias}\u0000${row.playerId}`;
    const existing = map.get(key);
    if (!existing || row.confidence > existing.confidence) map.set(key, row);
  }
  return Array.from(map.values());
}

function readContextAndBuildPlan(db: Database, args: ScriptArgs): { context: TeamContext; plan: ImportPlan } {
  const dump = readWorkbook(args.workbookPath);
  const context = loadTeamContext(db, args.teamName, args.season);
  const plan = buildImportPlan(dump, context);
  plan.aliasWrites = dedupeAliasWrites(plan.aliasWrites);
  return { context, plan };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const workbookPath = resolvePath(args.workbookPath);
  const dbPath = resolvePath(args.dbPath);
  if (!existsSync(workbookPath)) throw new Error(`Workbook not found: ${workbookPath}`);
  if (!existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

  if (args.apply) checkServerProcs({ force: args.force });

  const db = openDb(dbPath);
  try {
    const { context, plan } = readContextAndBuildPlan(db, { ...args, workbookPath });
    printPlan(plan);
    if (!args.apply) {
      log.info('Dry-run only. Re-run with --apply to write changes.');
      return;
    }
    applyPlan(db, context.teamId, plan);
    log.info(
      `Applied ${plan.stats.length} player stat rows across ${new Set(plan.mappedSheets.map((s) => s.gameId)).size} games.`,
    );
  } finally {
    db.close();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
