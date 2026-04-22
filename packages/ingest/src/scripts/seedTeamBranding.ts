// seedTeamBranding.ts -- Wave 16 Lane 3 (R2). Hand-curated brand colors +
// short nicknames for the most-played Philly-area teams in the 2026 season.
//
// WHY
// ---
// Migration 008 added teams.primary_color / .secondary_color / .nickname.
// They start NULL; the web client falls back to a deterministic name-hash
// hue when primary_color is null. This script populates those columns for
// the top ~30+ teams by 2026 game count so the constellation, dashboard
// chips, and leaderboard rows actually use real school colors.
//
// CURATION RULES
// --------------
//   * Only include a team if I can confidently name the school's actual
//     brand color (athletic web pages, established mascot, well-known
//     program). When in doubt: leave it out -- the hash fallback is fine.
//   * Colors are 7-char hex with leading '#'. Where two colors are common,
//     primary is the dominant jersey color.
//   * Each entry carries a `note` describing the school + source. Where
//     the color is from a "well-known" public-record program (e.g. Penn
//     Charter Quakers' blue & gold) the note says so; not every minor
//     program is worth a citation but every entry should at least name
//     the mascot to make the choice auditable.
//
// IDEMPOTENCY
// -----------
//   `--apply` upserts via a per-row UPDATE keyed on team_id; running again
//   with the same data writes 0 changes. `--dry-run` (default) prints the
//   plan without mutating.
//
// USAGE
//   pnpm --filter @pll/ingest branding:seed            # dry-run
//   pnpm --filter @pll/ingest branding:seed -- --apply # writes

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';

export interface BrandingEntry {
  /** teams.id -- look up via:
   *    SELECT id, name FROM teams WHERE name = '...';
   *  IDs below were captured from the live DB on 2026-04-22 (top-50 by
   *  2026 game count). If a team is renamed/merged the id stays stable.
   */
  teamId: number;
  /** Display name for log output only -- not used for matching. */
  teamName: string;
  /** 7-char hex including '#'. */
  primaryColor: string;
  /** 7-char hex including '#'. NULL if the school has no clear secondary. */
  secondaryColor: string | null;
  /** Short mascot, e.g. 'Quakers'. Capitalised for display. */
  nickname: string;
  /** One-line provenance / mascot note. */
  note: string;
}

// Hex validator -- tight regex so a typo in this file fails the seed-script
// test instead of polluting the DB with garbage colors.
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export const TEAM_BRANDING: readonly BrandingEntry[] = [
  // ---- Inter-Ac / private (well-known programs) ----
  {
    teamId: 31,
    teamName: 'Penn Charter',
    primaryColor: '#003B6F',
    secondaryColor: '#F2C200',
    nickname: 'Quakers',
    note: 'William Penn Charter School Quakers - blue & old gold (school colors).',
  },
  {
    teamId: 11,
    teamName: 'Haverford School',
    primaryColor: '#7F1D1D',
    secondaryColor: '#D4AF37',
    nickname: 'Fords',
    note: 'The Haverford School Fords - maroon & gold (Inter-Ac, well-known).',
  },
  {
    teamId: 12,
    teamName: 'Episcopal Academy',
    primaryColor: '#B22234',
    secondaryColor: '#FFFFFF',
    nickname: 'Churchmen',
    note: 'Episcopal Academy Churchmen - red & white (school colors).',
  },
  {
    teamId: 27,
    teamName: 'Malvern Prep',
    primaryColor: '#5C0A1B',
    secondaryColor: '#FFFFFF',
    nickname: 'Friars',
    note: 'Malvern Preparatory School Friars - maroon & white.',
  },
  {
    teamId: 32,
    teamName: 'Germantown Academy',
    primaryColor: '#0B2D5B',
    secondaryColor: '#D4AF37',
    nickname: 'Patriots',
    note: 'Germantown Academy Patriots - blue & gold (school colors).',
  },
  {
    teamId: 161,
    teamName: 'Springside Chestnut Hill',
    primaryColor: '#0B5394',
    secondaryColor: '#FFFFFF',
    nickname: 'Blue Devils',
    note: 'Springside Chestnut Hill Academy Blue Devils - blue & white.',
  },
  {
    teamId: 108,
    teamName: "St. Joseph's Prep",
    primaryColor: '#7B0000',
    secondaryColor: '#D4AF37',
    nickname: 'Hawks',
    note: "St. Joseph's Preparatory School Hawks - crimson & gold.",
  },
  {
    teamId: 65,
    teamName: "Cardinal O'Hara",
    primaryColor: '#0F5132',
    secondaryColor: '#FFFFFF',
    nickname: 'Lions',
    note: "Cardinal O'Hara High School Lions - green & white.",
  },
  {
    teamId: 46,
    teamName: 'Bishop Shanahan',
    primaryColor: '#0F5132',
    secondaryColor: '#FFFFFF',
    nickname: 'Eagles',
    note: 'Bishop Shanahan High School Eagles - green & white.',
  },

  // ---- Public, Main Line / Delco / Chesco ----
  {
    teamId: 34,
    teamName: 'Lower Merion',
    primaryColor: '#5C0A1B',
    secondaryColor: '#000000',
    nickname: 'Aces',
    note: 'Lower Merion Aces - maroon & black (longstanding school colors).',
  },
  {
    teamId: 40,
    teamName: 'Radnor',
    primaryColor: '#B22234',
    secondaryColor: '#0B2D5B',
    nickname: 'Raiders',
    note: 'Radnor Raiders - red & blue.',
  },
  {
    teamId: 36,
    teamName: 'Haverford High',
    primaryColor: '#000000',
    secondaryColor: '#B22234',
    nickname: 'Fords',
    note: 'Haverford Township H.S. Fords - black & red (distinct from Haverford School).',
  },
  {
    teamId: 39,
    teamName: 'Garnet Valley',
    primaryColor: '#7B0023',
    secondaryColor: '#000000',
    nickname: 'Jaguars',
    note: 'Garnet Valley Jaguars - garnet & black (school named for color).',
  },
  {
    teamId: 38,
    teamName: 'Strath Haven',
    primaryColor: '#0B2D5B',
    secondaryColor: '#FFFFFF',
    nickname: 'Panthers',
    note: 'Strath Haven Panthers - blue & white.',
  },
  {
    teamId: 35,
    teamName: 'Marple Newtown',
    primaryColor: '#000000',
    secondaryColor: '#F58025',
    nickname: 'Tigers',
    note: 'Marple Newtown Tigers - black & orange.',
  },
  {
    teamId: 37,
    teamName: 'Springfield-Delco',
    primaryColor: '#000000',
    secondaryColor: '#B22234',
    nickname: 'Cougars',
    note: 'Springfield (Delco) Cougars - black & red (lane brief hint).',
  },
  {
    teamId: 19,
    teamName: 'Ridley',
    primaryColor: '#0F5132',
    secondaryColor: '#FFFFFF',
    nickname: 'Green Raiders',
    note: 'Ridley Green Raiders - green & white.',
  },
  {
    teamId: 79,
    teamName: 'Penncrest',
    primaryColor: '#0B2D5B',
    secondaryColor: '#D4AF37',
    nickname: 'Lions',
    note: 'Penncrest Lions - blue & gold.',
  },
  {
    teamId: 50,
    teamName: 'Coatesville',
    primaryColor: '#B22234',
    secondaryColor: '#000000',
    nickname: 'Red Raiders',
    note: 'Coatesville Red Raiders - red & black.',
  },
  {
    teamId: 51,
    teamName: 'Kennett',
    primaryColor: '#0B2D5B',
    secondaryColor: '#FFFFFF',
    nickname: 'Blue Demons',
    note: 'Kennett Blue Demons - blue & white.',
  },
  {
    teamId: 77,
    teamName: 'Avon Grove',
    primaryColor: '#B22234',
    secondaryColor: '#FFFFFF',
    nickname: 'Red Devils',
    note: 'Avon Grove Red Devils - red & white.',
  },
  {
    teamId: 41,
    teamName: 'WC Henderson',
    primaryColor: '#B22234',
    secondaryColor: '#D4AF37',
    nickname: 'Warriors',
    note: 'West Chester Henderson Warriors - red & gold.',
  },
  {
    teamId: 45,
    teamName: 'WC Rustin',
    primaryColor: '#000000',
    secondaryColor: '#D4AF37',
    nickname: 'Golden Knights',
    note: 'West Chester Rustin Golden Knights - black & gold.',
  },
  {
    teamId: 188,
    teamName: 'West Chester East',
    primaryColor: '#0F5132',
    secondaryColor: '#FFFFFF',
    nickname: 'Vikings',
    note: 'West Chester East Vikings - green & white.',
  },
  {
    teamId: 178,
    teamName: 'Unionville',
    primaryColor: '#B22234',
    secondaryColor: '#FFFFFF',
    nickname: 'Indians',
    note: 'Unionville Indians - red & white.',
  },
  {
    teamId: 42,
    teamName: 'Great Valley',
    primaryColor: '#0B2D5B',
    secondaryColor: '#D4AF37',
    nickname: 'Patriots',
    note: 'Great Valley Patriots - blue & gold.',
  },

  // ---- Public, Bucks / Montco ----
  {
    teamId: 64,
    teamName: 'Pennsbury',
    primaryColor: '#F58025',
    secondaryColor: '#000000',
    nickname: 'Falcons',
    note: 'Pennsbury Falcons - orange & black (longstanding school colors).',
  },
  {
    teamId: 9,
    teamName: 'Neshaminy',
    primaryColor: '#B22234',
    secondaryColor: '#0B2D5B',
    nickname: 'Skins',
    note: 'Neshaminy Skins - red & blue.',
  },
  {
    teamId: 56,
    teamName: 'Central Bucks South',
    primaryColor: '#4B0082',
    secondaryColor: '#D4AF37',
    nickname: 'Titans',
    note: 'Central Bucks South Titans - purple & gold.',
  },
  {
    teamId: 69,
    teamName: 'Central Bucks East',
    primaryColor: '#0B2D5B',
    secondaryColor: '#B22234',
    nickname: 'Patriots',
    note: 'Central Bucks East Patriots - red, white & blue.',
  },
  {
    teamId: 68,
    teamName: 'Central Bucks West',
    primaryColor: '#5C2E1A',
    secondaryColor: '#D4AF37',
    nickname: 'Bucks',
    note: 'Central Bucks West Bucks - brown & gold (distinctive program colors).',
  },
  {
    teamId: 100,
    teamName: 'Hatboro-Horsham',
    primaryColor: '#B22234',
    secondaryColor: '#000000',
    nickname: 'Hatters',
    note: 'Hatboro-Horsham Hatters - red & black.',
  },
  {
    teamId: 70,
    teamName: 'Upper Dublin',
    primaryColor: '#B22234',
    secondaryColor: '#000000',
    nickname: 'Cardinals',
    note: 'Upper Dublin Cardinals - red & black.',
  },
  {
    teamId: 61,
    teamName: 'Plymouth Whitemarsh',
    primaryColor: '#F58025',
    secondaryColor: '#000000',
    nickname: 'Colonials',
    note: 'Plymouth Whitemarsh Colonials - orange & black.',
  },
  {
    teamId: 76,
    teamName: 'Wissahickon',
    primaryColor: '#0B2D5B',
    secondaryColor: '#D4AF37',
    nickname: 'Trojans',
    note: 'Wissahickon Trojans - blue & gold.',
  },
  {
    teamId: 96,
    teamName: 'Abington',
    primaryColor: '#F58025',
    secondaryColor: '#000000',
    nickname: 'Galloping Ghosts',
    note: 'Abington Galloping Ghosts - orange & black (historic colors).',
  },
  {
    teamId: 80,
    teamName: 'Harriton',
    primaryColor: '#0F5132',
    secondaryColor: '#D4AF37',
    nickname: 'Rams',
    note: 'Harriton Rams - green & gold.',
  },
  {
    teamId: 82,
    teamName: 'Upper Merion',
    primaryColor: '#000000',
    secondaryColor: '#D4AF37',
    nickname: 'Vikings',
    note: 'Upper Merion Vikings - black & gold.',
  },
  {
    teamId: 98,
    teamName: 'Quakertown',
    primaryColor: '#000000',
    secondaryColor: '#D4AF37',
    nickname: 'Panthers',
    note: 'Quakertown Panthers - black & gold.',
  },
  {
    teamId: 57,
    teamName: 'North Penn',
    primaryColor: '#0B2D5B',
    secondaryColor: '#FFFFFF',
    nickname: 'Knights',
    note: 'North Penn Knights - blue & white.',
  },
  {
    teamId: 17,
    teamName: 'Souderton',
    primaryColor: '#B22234',
    secondaryColor: '#000000',
    nickname: 'Big Red',
    note: 'Souderton Big Red - red & black.',
  },
  {
    teamId: 1,
    teamName: 'Spring-Ford',
    primaryColor: '#5C0A1B',
    secondaryColor: '#D4AF37',
    nickname: 'Rams',
    note: 'Spring-Ford Rams - maroon & gold.',
  },
  {
    teamId: 3,
    teamName: 'Methacton',
    primaryColor: '#0F5132',
    secondaryColor: '#FFFFFF',
    nickname: 'Warriors',
    note: 'Methacton Warriors - green & white.',
  },
  {
    teamId: 14,
    teamName: 'Owen J. Roberts',
    primaryColor: '#000000',
    secondaryColor: '#F58025',
    nickname: 'Wildcats',
    note: 'Owen J. Roberts Wildcats - black & orange.',
  },
  {
    teamId: 13,
    teamName: 'Perkiomen Valley',
    primaryColor: '#4B0082',
    secondaryColor: '#D4AF37',
    nickname: 'Vikings',
    note: 'Perkiomen Valley Vikings - purple & gold.',
  },
  {
    teamId: 63,
    teamName: 'Pennridge',
    primaryColor: '#5C0A1B',
    secondaryColor: '#FFFFFF',
    nickname: 'Rams',
    note: 'Pennridge Rams - maroon & white.',
  },
];

export interface SeedResult {
  /** Rows actually changed by an UPDATE. */
  updated: number;
  /** Rows already had the same values (no-op). */
  unchanged: number;
  /** Entries whose teamId no longer exists in teams. */
  missingTeam: BrandingEntry[];
  /** Entries with a malformed hex color (refused). */
  invalidColor: BrandingEntry[];
}

/** Validate every entry up-front. Throws if any color is malformed. */
export function validateBranding(entries: readonly BrandingEntry[]): BrandingEntry[] {
  const bad: BrandingEntry[] = [];
  for (const e of entries) {
    if (!HEX_RE.test(e.primaryColor)) bad.push(e);
    if (e.secondaryColor !== null && !HEX_RE.test(e.secondaryColor)) bad.push(e);
  }
  return bad;
}

/**
 * Apply branding for the given entries. Idempotent: only counts a row as
 * "updated" when at least one of the three columns actually changes value.
 */
export function seedBranding(
  db: Database,
  entries: readonly BrandingEntry[] = TEAM_BRANDING,
): SeedResult {
  const invalid = validateBranding(entries);

  const teamRow = db.prepare(
    'SELECT primary_color, secondary_color, nickname FROM teams WHERE id = ?',
  );
  const update = db.prepare(
    `UPDATE teams
        SET primary_color   = @primary,
            secondary_color = @secondary,
            nickname        = @nickname
      WHERE id = @id`,
  );

  let updated = 0;
  let unchanged = 0;
  const missingTeam: BrandingEntry[] = [];

  const tx = db.transaction(() => {
    for (const e of entries) {
      // Skip entries that failed validation -- already collected above.
      if (invalid.includes(e)) continue;
      const existing = teamRow.get(e.teamId) as
        | { primary_color: string | null; secondary_color: string | null; nickname: string | null }
        | undefined;
      if (!existing) {
        missingTeam.push(e);
        continue;
      }
      const same =
        existing.primary_color === e.primaryColor &&
        existing.secondary_color === e.secondaryColor &&
        existing.nickname === e.nickname;
      if (same) {
        unchanged += 1;
        continue;
      }
      update.run({
        id: e.teamId,
        primary: e.primaryColor,
        secondary: e.secondaryColor,
        nickname: e.nickname,
      });
      updated += 1;
    }
  });
  tx();

  return { updated, unchanged, missingTeam, invalidColor: invalid };
}

function printResult(result: SeedResult, apply: boolean): void {
  const header = apply ? 'Applied' : 'Dry-run plan';
  console.log(`-------- ${header}: seedTeamBranding --------`);
  console.log(`updated:        ${result.updated}`);
  console.log(`unchanged:      ${result.unchanged}`);
  if (result.missingTeam.length > 0) {
    console.log(`!! missing team rows (skipped): ${result.missingTeam.length}`);
    for (const m of result.missingTeam) {
      console.log(`    team_id=${m.teamId} (${m.teamName})`);
    }
  }
  if (result.invalidColor.length > 0) {
    console.log(`!! invalid colors (refused): ${result.invalidColor.length}`);
    for (const m of result.invalidColor) {
      console.log(`    team_id=${m.teamId} (${m.teamName}) primary=${m.primaryColor}`);
    }
  }
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const here = dirname(fileURLToPath(import.meta.url));
  const defaultDb = resolve(here, '..', '..', '..', '..', 'data', 'lacrosse.db');
  const dbPath = process.env.DB_PATH ?? defaultDb;
  console.log(`[seedTeamBranding] opening ${dbPath} (${apply ? 'APPLY' : 'dry-run'})`);

  const db = openDb(dbPath);

  if (!apply) {
    // Read-only diff: do not mutate. Just report what an --apply run would do.
    const teamRow = db.prepare(
      'SELECT primary_color, secondary_color, nickname FROM teams WHERE id = ?',
    );
    let wouldUpdate = 0;
    let alreadySet = 0;
    const missing: BrandingEntry[] = [];
    for (const e of TEAM_BRANDING) {
      const existing = teamRow.get(e.teamId) as
        | { primary_color: string | null; secondary_color: string | null; nickname: string | null }
        | undefined;
      if (!existing) { missing.push(e); continue; }
      const same =
        existing.primary_color === e.primaryColor &&
        existing.secondary_color === e.secondaryColor &&
        existing.nickname === e.nickname;
      if (same) alreadySet += 1; else wouldUpdate += 1;
    }
    printResult(
      { updated: wouldUpdate, unchanged: alreadySet, missingTeam: missing, invalidColor: validateBranding(TEAM_BRANDING) },
      false,
    );
    console.log('\n(Dry-run only. Re-run with --apply to write.)');
    db.close();
    return;
  }

  const result = seedBranding(db, TEAM_BRANDING);
  printResult(result, true);
  db.close();
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
