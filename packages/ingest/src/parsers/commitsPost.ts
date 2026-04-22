// commitsPost.ts — parse a phillylacrosse.com commits post.
//
// Wave 15 Lane 3 (Han 🧑‍🚀🍔). Two distinct shapes observed in the live
// corpus on /category/recruiting/ — both must produce the same row shape:
//
//   1. List post ("Recent boys' commitments"). Sections nested by class +
//      division header, then one player per line:
//        Class of 2026
//        Division I
//        Colin Gallagher, Twin Valley/Fusion, MID, Marquette
//        Division II
//        Timmy Gathercole, Downingtown West/Freedom, SSDM/MID, Chestnut Hill
//
//   2. Single-commit profile. Title carries the headline, body has labelled
//      lines we can scrape:
//        High school: Appoquinimink High School, Middletown, DE
//        Position: attackman
//        Grad year: 2025
//        College committed to: Delaware Technical Community College
//
// Defensive: anything we can't confidently parse is emitted as a
// `ParsedAnomaly` rather than thrown — pipeline writes them to
// `ingest_anomalies` keyed on the source post.

import type { ParsedAnomaly } from '@pll/shared';
import { htmlToTextLines, normalizeUnicodeQuotes, normalizeWhitespace } from './text.js';

export interface ParsedCommit {
  /** Verbatim "First Last" as it appeared in the post. */
  playerNameRaw: string;
  /** Best-guess high school (no "/Club" suffix, no city/state tail). */
  highSchool: string | null;
  /** College the player committed to. Required; rows without one are anomalies. */
  college: string;
  /** D1 | D2 | D3 | NAIA | JUCO if derivable from headers/text, else null. */
  division: string | null;
  /** Position abbrev/name if observed (ATT, MID, DEF, GK, LSM …). */
  position: string | null;
  /** ISO YYYY-MM-DD if a "Posted MM/DD/YY" line was found. */
  announcedDate: string | null;
}

export interface ParsedCommitsPost {
  commits: ParsedCommit[];
  anomalies: ParsedAnomaly[];
  /** True if the post body looked like commit content (commit-shaped). */
  isCommitPost: boolean;
}

const DIVISION_RE = /\bdivision\s+(i{1,3}v?|1|2|3)\b/i;
const NAIA_RE = /\bnaia\b/i;
const JUCO_RE = /\bjuco|njcaa\b/i;
const POSTED_DATE_RE = /Posted\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i;
const TITLE_RE = /<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/i;
const FILED_UNDER_RE = /Filed Under:[^<]*?(Girl|Women|Female)/i;

function divisionFromText(s: string): string | null {
  if (NAIA_RE.test(s)) return 'NAIA';
  if (JUCO_RE.test(s)) return 'JUCO';
  const m = s.match(DIVISION_RE);
  if (!m) return null;
  const v = m[1]!.toUpperCase();
  if (v === 'I' || v === '1') return 'D1';
  if (v === 'II' || v === '2') return 'D2';
  if (v === 'III' || v === '3') return 'D3';
  if (v === 'IV') return 'D3'; // unlikely but keep loose
  return null;
}

function isoDateFromPosted(s: string): string | null {
  const m = s.match(POSTED_DATE_RE);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  let yy = Number(m[3]);
  if (yy < 100) yy = 2000 + yy;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** Strip a trailing "/Club Name" segment from a HS slot ("Twin Valley/Fusion"). */
function highSchoolFromSlot(slot: string): string {
  const slash = slot.indexOf('/');
  const base = slash >= 0 ? slot.slice(0, slash) : slot;
  return base.replace(/\s*\([A-Z]{2,3}\)\s*$/i, '').trim();
}

/** Drop trailing year token like "Class of 2030" / "'30" from a college name. */
function cleanCollege(raw: string): string {
  return raw
    .replace(/['’]\s*\d{2,4}\s*$/u, '')
    .replace(/\s+\b(?:class\s+of\s+)?20\d{2}\s*$/i, '')
    .replace(/[\.;,]+$/u, '')
    .trim();
}

function extractTitle(html: string): string | null {
  const m = html.match(TITLE_RE);
  if (!m) return null;
  return normalizeWhitespace(normalizeUnicodeQuotes(m[1]!.replace(/<[^>]+>/g, ''))) || null;
}

function lineLooksLikeListEntry(line: string): boolean {
  // Want: "Name, HS/Club, POS, College"  — at least 3 commas.
  const commas = (line.match(/,/g) ?? []).length;
  if (commas < 2) return false;
  // Must start with a Name (two title-cased words is the modal case).
  if (!/^[A-Z][A-Za-z'’.\-]+\s+[A-Z][A-Za-z'’.\-]+/.test(line)) return false;
  // Reject metadata/footer lines like "Filed Under: ..." or "Tagged With: ...".
  if (/^(?:Filed\s+Under|Tagged\s+With|Posted\s+By|Class\s+of)\b/i.test(line)) return false;
  // Reject lines that clearly belong to running prose (sentence verbs).
  if (/\b(?:said|added|told|reported|congratulat|announce|please|join)\w*\b/i.test(line)) {
    return false;
  }
  return true;
}

function parseListEntry(line: string): { name: string; hs: string; pos: string | null; college: string } | null {
  // Split on commas, but allow the college field to contain commas
  // ("University of Maryland, Baltimore County") by walking from the end.
  const parts = line.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  // Heuristic: name is part 0, hs/club is part 1, position is part 2 if it
  // looks position-shaped, college is the remainder joined back together.
  const name = parts[0]!;
  const hs = highSchoolFromSlot(parts[1]!);
  let pos: string | null = null;
  let collegeStart = 2;
  const part2 = parts[2]!;
  if (/^[A-Z]{1,5}(?:\/[A-Z]{1,5})?$/.test(part2) || /^(?:goalie|attack|midfield|defense|long\s*pole)$/i.test(part2)) {
    pos = part2;
    collegeStart = 3;
  }
  if (collegeStart >= parts.length) return null;
  const college = cleanCollege(parts.slice(collegeStart).join(', '));
  if (!name || !hs || !college) return null;
  return { name, hs, pos, college };
}

function parseProfilePost(lines: string[]): { commit: ParsedCommit | null; anomaly: ParsedAnomaly | null } {
  // Pull labelled fields from the body. Regexes are forgiving on whitespace
  // around the colon and the value; case-insensitive on the label.
  let highSchool: string | null = null;
  let college: string | null = null;
  let position: string | null = null;
  let nameGuess: string | null = null;
  let division: string | null = null;
  for (const raw of lines) {
    const line = normalizeWhitespace(raw);
    if (!line) continue;
    // Track the most recent standalone Title-Case name line as a fallback for
    // posts that don't repeat the player's name in the labelled "Name:" slot.
    if (/^[A-Z][a-z]+(?:\s+[A-Z][A-Za-z'’.\-]+)+$/.test(line) && line.length < 60) {
      nameGuess = nameGuess ?? line;
    }
    const hsMatch = line.match(/^high\s*school\s*:\s*(.+)$/i);
    if (hsMatch) {
      // "Appoquinimink High School, Middletown, DE" → "Appoquinimink High School"
      highSchool = hsMatch[1]!.split(',')[0]!.trim();
      continue;
    }
    const collegeMatch = line.match(/^(?:college\s+committed\s+to|committed\s+to|college)\s*:\s*(.+)$/i);
    if (collegeMatch) {
      college = cleanCollege(collegeMatch[1]!);
      continue;
    }
    const posMatch = line.match(/^position\s*:\s*(.+)$/i);
    if (posMatch) {
      position = posMatch[1]!.split(/[,;]/)[0]!.trim();
      continue;
    }
    if (!division) division = divisionFromText(line);
  }
  if (!college) {
    return {
      commit: null,
      anomaly: {
        rawLine: lines.slice(0, 4).join(' | '),
        strategyAttempted: 'commits-profile',
        reason: 'no college committed-to line found',
      },
    };
  }
  if (!nameGuess) {
    return {
      commit: null,
      anomaly: {
        rawLine: lines.slice(0, 4).join(' | '),
        strategyAttempted: 'commits-profile',
        reason: 'could not identify player name',
      },
    };
  }
  return {
    commit: {
      playerNameRaw: nameGuess,
      highSchool,
      college,
      division,
      position,
      announcedDate: null,
    },
    anomaly: null,
  };
}

export function parseCommitsPost(html: string): ParsedCommitsPost {
  const anomalies: ParsedAnomaly[] = [];
  const commits: ParsedCommit[] = [];

  // Hard-skip girls/women's commits posts — boys-only ingest contract.
  if (FILED_UNDER_RE.test(html)) {
    return { commits: [], anomalies: [], isCommitPost: false };
  }

  const title = extractTitle(html) ?? '';
  const lines = htmlToTextLines(html).map((l) => normalizeWhitespace(normalizeUnicodeQuotes(l)));
  const announcedDate = isoDateFromPosted(lines.join('\n'));

  // Decide shape: the list-format header is the giveaway.
  const isListPost =
    /recent\s+boys?'?\s+commitments?/i.test(title) ||
    lines.some((l) => /^class\s+of\s+20\d{2}\s*$/i.test(l));

  // Profile shape: structured labelled fields in the body.
  const isProfilePost =
    /commits?\s+to|has\s+committed/i.test(title) &&
    lines.some((l) => /^college\s+committed\s+to\s*:/i.test(l));

  if (!isListPost && !isProfilePost) {
    // Not commit-shaped — caller will skip the post.
    return { commits: [], anomalies: [], isCommitPost: false };
  }

  if (isListPost) {
    let currentDivision: string | null = null;
    for (const line of lines) {
      if (/^class\s+of\s+20\d{2}\s*$/i.test(line)) {
        // Reset division at each new class header.
        currentDivision = null;
        continue;
      }
      const div = divisionFromText(line);
      // A pure division header line (≤ 25 chars, mostly the keyword).
      if (div && line.length < 25) {
        currentDivision = div;
        continue;
      }
      if (!lineLooksLikeListEntry(line)) continue;
      const parsed = parseListEntry(line);
      if (!parsed) {
        anomalies.push({
          rawLine: line,
          strategyAttempted: 'commits-list',
          reason: 'list entry did not match Name, HS, POS, College shape',
        });
        continue;
      }
      commits.push({
        playerNameRaw: parsed.name,
        highSchool: parsed.hs,
        college: parsed.college,
        division: currentDivision,
        position: parsed.pos,
        announcedDate,
      });
    }
    return { commits, anomalies, isCommitPost: true };
  }

  // Profile post.
  const r = parseProfilePost(lines);
  if (r.commit) {
    commits.push({ ...r.commit, announcedDate });
  }
  if (r.anomaly) anomalies.push(r.anomaly);
  return { commits, anomalies, isCommitPost: true };
}
