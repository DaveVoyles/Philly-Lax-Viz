// scheduleCsv.ts — parse the PIAA D1 "Export Full Schedule" CSV.
//
// The CSV is served at:
//   /sports/spring-sports/lacrosse-b/scores-and-rankings/export
//     ?type=games&year=YYYY&sport=BoysLacrosse
//
// Header (W16 capture):
//   "Date","Sport","Game Completed","Exclude From Ranking",
//   "Home Team","Home Score","Visitor Team","Visitor Score"
//
// We treat any row where `Game Completed` is "No" (case-insensitive) as
// an UPCOMING game and emit it. Completed rows are skipped here — they
// belong to the recap pipeline. The PIAA CSV has no game-time or
// location column, so those fields are returned as null.

export interface ScheduleCsvRow {
  date: string;             // YYYY-MM-DD
  homeTeamRaw: string;
  awayTeamRaw: string;
  completed: boolean;
  homeScore: number | null;
  awayScore: number | null;
}

export interface ParsedScheduleCsv {
  rows: ScheduleCsvRow[];
  /** Raw rows we couldn't parse (bad date, missing field). For triage. */
  malformed: { line: string; reason: string }[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Tiny CSV splitter that respects "..." quoted fields with comma inside. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function parseScheduleCsv(csv: string): ParsedScheduleCsv {
  const rows: ScheduleCsvRow[] = [];
  const malformed: { line: string; reason: string }[] = [];

  // Strip BOM, normalise newlines, drop blank lines.
  const cleaned = csv.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = cleaned.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return { rows, malformed };

  const header = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const idx = (name: string): number => header.indexOf(name.toLowerCase());
  const iDate = idx('date');
  const iCompleted = idx('game completed');
  const iHome = idx('home team');
  const iHomeScore = idx('home score');
  const iAway = idx('visitor team');
  const iAwayScore = idx('visitor score');

  if (iDate < 0 || iHome < 0 || iAway < 0) {
    malformed.push({ line: lines[0]!, reason: 'header missing required columns' });
    return { rows, malformed };
  }

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    const cols = splitCsvLine(line).map((c) => c.trim());
    const date = cols[iDate] ?? '';
    const home = cols[iHome] ?? '';
    const away = cols[iAway] ?? '';
    if (!ISO_DATE.test(date)) {
      malformed.push({ line, reason: `bad date: ${JSON.stringify(date)}` });
      continue;
    }
    if (!home || !away) {
      malformed.push({ line, reason: 'missing home/away team' });
      continue;
    }
    const completedRaw = (cols[iCompleted] ?? '').toLowerCase();
    const completed = completedRaw === 'yes' || completedRaw === 'true' || completedRaw === '1';
    const homeScore = parseScore(cols[iHomeScore]);
    const awayScore = parseScore(cols[iAwayScore]);
    rows.push({ date, homeTeamRaw: home, awayTeamRaw: away, completed, homeScore, awayScore });
  }

  return { rows, malformed };
}

function parseScore(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
