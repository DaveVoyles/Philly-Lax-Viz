import * as XLSX from 'xlsx';

export interface ParsedUploadRow {
  playerName: string;
  gameDate: string;
  opponent: string;
  goals: number;
  assists: number;
  groundBalls: number;
  causedTurnovers: number;
  saves: number;
  foWon: number;
  foTaken: number;
}

export interface ParsedUploadError {
  row: number;
  message: string;
}

export interface ParseUploadSheetResult {
  rows: ParsedUploadRow[];
  errors: ParsedUploadError[];
}

type UploadColumn = keyof ParsedUploadRow;

const COLUMN_ALIASES: Record<UploadColumn, string[]> = {
  playerName: ['player', 'name', 'player_name'],
  gameDate: ['game date', 'date', 'game_date'],
  opponent: ['opponent', 'vs', 'opp'],
  goals: ['goals', 'g'],
  assists: ['assists', 'a'],
  groundBalls: ['ground balls', 'gbs', 'groundballs', 'ground_balls', 'gb'],
  causedTurnovers: ['caused turnovers', 'cts', 'causedturnovers', 'caused_turnovers', 'ct'],
  saves: ['saves', 'sv'],
  foWon: ['fo won', 'faceoffs won', 'fo_won'],
  foTaken: ['fo taken', 'faceoffs', 'fo_taken', 'fo'],
};

const REQUIRED_COLUMNS: readonly UploadColumn[] = ['playerName', 'gameDate'];
const NUMERIC_COLUMNS: readonly UploadColumn[] = [
  'goals',
  'assists',
  'groundBalls',
  'causedTurnovers',
  'saves',
  'foWon',
  'foTaken',
];

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function cleanCell(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"').trim();
  }
  return trimmed;
}

function splitCsvLine(line: string): string[] {
  return line.split(',').map(cleanCell);
}

function isBlankValue(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

function isBlankRow(values: unknown[]): boolean {
  return values.every((value) => isBlankValue(value));
}

function buildHeaderMap(headers: string[]): Map<number, UploadColumn> {
  const aliasToColumn = new Map<string, UploadColumn>();
  for (const [column, aliases] of Object.entries(COLUMN_ALIASES) as Array<[UploadColumn, string[]]>) {
    for (const alias of aliases) aliasToColumn.set(normalizeHeader(alias), column);
  }

  const out = new Map<number, UploadColumn>();
  headers.forEach((header, index) => {
    const column = aliasToColumn.get(normalizeHeader(header));
    if (column) out.set(index, column);
  });
  return out;
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDateValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return formatDate(parsed.y, parsed.m, parsed.d);
  }

  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const month = Number.parseInt(slashMatch[1]!, 10);
    const day = Number.parseInt(slashMatch[2]!, 10);
    const yearRaw = Number.parseInt(slashMatch[3]!, 10);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    return formatDate(year, month, day);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseNumericValue(value: unknown): number | null {
  if (isBlankValue(value)) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRow(rawValues: unknown[], rowNumber: number, headerMap: Map<number, UploadColumn>): {
  row?: ParsedUploadRow;
  errors: ParsedUploadError[];
} {
  const base: ParsedUploadRow = {
    playerName: '',
    gameDate: '',
    opponent: '',
    goals: 0,
    assists: 0,
    groundBalls: 0,
    causedTurnovers: 0,
    saves: 0,
    foWon: 0,
    foTaken: 0,
  };

  for (const [index, column] of headerMap.entries()) {
    const value = rawValues[index];
    if (NUMERIC_COLUMNS.includes(column)) {
      const parsed = parseNumericValue(value);
      if (parsed === null) {
        return {
          errors: [{ row: rowNumber, message: `Invalid ${column}` }],
        };
      }
      base[column] = parsed as never;
      continue;
    }

    if (column === 'gameDate') {
      const parsedDate = parseDateValue(value);
      if (!parsedDate) {
        return {
          errors: [{ row: rowNumber, message: 'Invalid gameDate' }],
        };
      }
      base.gameDate = parsedDate;
      continue;
    }

    base[column] = String(value ?? '').trim() as never;
  }

  const errors: ParsedUploadError[] = [];
  for (const column of REQUIRED_COLUMNS) {
    if (!base[column]) errors.push({ row: rowNumber, message: `${column} is required` });
  }
  return errors.length > 0 ? { errors } : { row: base, errors: [] };
}

function parseMatrix(matrix: unknown[][]): ParseUploadSheetResult {
  if (matrix.length === 0) {
    return { rows: [], errors: [{ row: 1, message: 'Sheet is empty' }] };
  }

  const headers = (matrix[0] ?? []).map((value) => String(value ?? '').trim());
  const headerMap = buildHeaderMap(headers);
  const rows: ParsedUploadRow[] = [];
  const errors: ParsedUploadError[] = [];

  for (let index = 1; index < matrix.length; index += 1) {
    const rawRow = matrix[index] ?? [];
    if (isBlankRow(rawRow)) continue;
    const parsed = parseRow(rawRow, index + 1, headerMap);
    rows.push(...(parsed.row ? [parsed.row] : []));
    errors.push(...parsed.errors);
  }

  return { rows, errors };
}

function parseCsv(buffer: Buffer): ParseUploadSheetResult {
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const matrix = lines.map((line) => splitCsvLine(line));
  return parseMatrix(matrix);
}

function parseXlsx(buffer: Buffer): ParseUploadSheetResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { rows: [], errors: [{ row: 1, message: 'Workbook has no sheets' }] };
  }
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    return { rows: [], errors: [{ row: 1, message: 'Workbook sheet could not be read' }] };
  }
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][];
  return parseMatrix(matrix);
}

export function parseUploadSheet(buffer: Buffer, mimeType: string): ParseUploadSheetResult {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('csv') || normalized.includes('text/plain')) {
    return parseCsv(buffer);
  }
  if (normalized.includes('sheet') || normalized.includes('excel')) {
    return parseXlsx(buffer);
  }
  throw new Error(`Unsupported upload mime type: ${mimeType}`);
}
