// seedTeamAliases.ts — bootstrap team_aliases for PIAA-name variants.
//
// Wave 6 Lane 1: 49 of 59 PIAA District 1 teams join cleanly to teams.name
// via LOWER(name) = name_normalized. The remaining 10 either need an alias
// row or correspond to teams we don't track (PhillyLacrosse RSS coverage
// gap). This script seeds the genuine matches and skips the rest.
//
// Mappings (verified manually 2026-04-22 against live data/lacrosse.db):
//   cb south            -> 56  Central Bucks South
//   cb west             -> 68  Central Bucks West
//   hatborohorsham      -> 100 Hatboro-Horsham      (PIAA strips the hyphen)
//   haverford           -> 36  Haverford High       (NOT 11 Haverford School;
//                                                   Haverford School is the
//                                                   private Inter-Ac team and
//                                                   a different program)
//   new hope solebury   -> 10  New Hope-Solebury    (W8 dedup kept the hyphen
//                                                   variant; PIAA name uses a
//                                                   space, so add an alias)
//   owen j roberts      -> 14  Owen J. Roberts
//   springfield         -> 37  Springfield-Delco    (PIAA 3A delco)
//   springfield twp     -> 174 Springfield Township (PIAA 2A montco)
//   springford          -> 1   Spring-Ford
//
// Skipped (no corresponding teams row, both 0-0 PIAA records):
//   harry s truman, william tennent
//
// Idempotent: uses INSERT OR IGNORE against the UNIQUE(alias) constraint.
//
// Usage:
//   pnpm --filter @pll/ingest aliases:seed            # dry-run
//   pnpm --filter @pll/ingest aliases:seed -- --apply # writes

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';

import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:seedTeamAliases' });
export interface AliasMapping {
  alias: string;
  teamId: number;
  /** Human-readable team name, for logs only. */
  teamName: string;
}

export const PIAA_ALIASES: readonly AliasMapping[] = [
  { alias: 'cb south', teamId: 56, teamName: 'Central Bucks South' },
  { alias: 'cb west', teamId: 68, teamName: 'Central Bucks West' },
  { alias: 'hatborohorsham', teamId: 100, teamName: 'Hatboro-Horsham' },
  { alias: 'haverford', teamId: 36, teamName: 'Haverford High' },
  { alias: 'new hope solebury', teamId: 10, teamName: 'New Hope-Solebury' },
  { alias: 'owen j roberts', teamId: 14, teamName: 'Owen J. Roberts' },
  { alias: 'springfield', teamId: 37, teamName: 'Springfield-Delco' },
  { alias: 'springfield twp', teamId: 174, teamName: 'Springfield Township' },
  { alias: 'springford', teamId: 1, teamName: 'Spring-Ford' },
];

export const ALIAS_SOURCE = 'piaa-bootstrap';

// ─── Wave 10 Lane 1 — parser-abbreviation aliases ────────────────────────
//
// The Wave 9 parser-strictness fix turned silent default-to-home into hard
// anomalies. Top remaining anomaly bucket (2,694 of 3,140) is "sub-header
// did not match either game team": real player-stat blocks whose team token
// is a short abbreviation (MHS, JBHA, OJR, …) the resolver cannot map.
//
// All mappings below were derived from the W10 anomaly-table top-N hits
// and verified by id against the live data/lacrosse.db on 2026-04-22:
//
//   sqlite3 data/lacrosse.db "SELECT id,name FROM teams WHERE id IN (...);"
//
// Aliases are written in normalized form (lowercase, internal whitespace
// collapsed, trailing HS/H.S./High School stripped — see normalizeTeamName).
//
// Springside Chestnut Hill and Jack Barrack target the canonical row left
// after the W10 dedupTeams pass (id 161 and 53 respectively). The dedup
// pass also re-targets any aliases attached to merged-from rows.
export const PARSER_ABBREVIATIONS: readonly AliasMapping[] = [
  { alias: 'umerion', teamId: 82, teamName: 'Upper Merion' },
  { alias: 'qhs', teamId: 98, teamName: 'Quakertown' },
  { alias: 'mhs', teamId: 3, teamName: 'Methacton' },
  { alias: 'phx', teamId: 4, teamName: 'Phoenixville' },
  { alias: 'jbha', teamId: 53, teamName: 'Jack Barrack' },
  { alias: 'jack barrack academy', teamId: 53, teamName: 'Jack Barrack' },
  { alias: 'jack barrack hebrew academy', teamId: 53, teamName: 'Jack Barrack' },
  { alias: 'hhs', teamId: 36, teamName: 'Haverford High' },
  { alias: 'dte', teamId: 43, teamName: 'Downingtown East' },
  { alias: 'dtw', teamId: 84, teamName: 'Downingtown West' },
  { alias: 'ojr', teamId: 14, teamName: 'Owen J. Roberts' },
  { alias: 'pjp', teamId: 18, teamName: 'Pope John Paul II' },
  { alias: 'sjp', teamId: 108, teamName: "St. Joseph's Prep" },
  { alias: 'wch', teamId: 41, teamName: 'WC Henderson' },
  { alias: 'wce', teamId: 188, teamName: 'West Chester East' },
  { alias: 'cbe', teamId: 69, teamName: 'Central Bucks East' },
  { alias: 'cb east', teamId: 69, teamName: 'Central Bucks East' },
  { alias: 'cbw', teamId: 68, teamName: 'Central Bucks West' },
  { alias: 'abw', teamId: 59, teamName: 'Archbishop Wood' },
  { alias: 'sch', teamId: 161, teamName: 'Springside Chestnut Hill' },
  { alias: 'springside chestnut hill academy', teamId: 161, teamName: 'Springside Chestnut Hill' },
  { alias: 'tv', teamId: 48, teamName: 'Twin Valley' },
  { alias: 'ga', teamId: 32, teamName: 'Germantown Academy' },
  { alias: 'ea', teamId: 12, teamName: 'Episcopal Academy' },
  { alias: 'lm', teamId: 34, teamName: 'Lower Merion' },
  { alias: 'pc', teamId: 31, teamName: 'Penn Charter' },
  { alias: 'shanahan', teamId: 46, teamName: 'Bishop Shanahan' },
  { alias: "o'hara", teamId: 65, teamName: "Cardinal O'Hara" },
  // Post-merge alias breadcrumbs — the dedup pass collapses these display
  // names into their canonical row; the alias keeps any future raw-text
  // occurrence resolving to the right team.
  { alias: 'barrack academy', teamId: 53, teamName: 'Jack Barrack' },
  { alias: 'wc east', teamId: 188, teamName: 'West Chester East' },
  { alias: 'wc henderson', teamId: 41, teamName: 'WC Henderson' },
  { alias: 'hatboro horsham', teamId: 100, teamName: 'Hatboro-Horsham' },
  // Short-form sub-headers the parser saw inside player blocks (verified
  // against raw-cache HTML; no other PA-area program shares these tokens
  // in our dataset, so confidence remains high).
  { alias: 'ryan', teamId: 62, teamName: 'Archbishop Ryan' },

  // ─── Wave 11 Lane 1 — high-frequency sub-header tokens ────────────────
  // Added after Chewy 🐻💪's parser suffix-strip pass surfaced ~1,720
  // remaining sub-header anomalies. Each token below was verified against
  // the live anomaly table by joining `ingest_anomalies.parent_game_id`
  // back to `games` and confirming the token's team appears as either
  // home or away in EVERY anomaly row (i.e. unambiguous, in-game).
  { alias: 'pv', teamId: 13, teamName: 'Perkiomen Valley' },
  { alias: 'rustin', teamId: 45, teamName: 'WC Rustin' },
  { alias: 'mn', teamId: 35, teamName: 'Marple Newtown' },
  { alias: 'hgp', teamId: 16, teamName: 'Holy Ghost Prep' },
  { alias: 'wiss', teamId: 76, teamName: 'Wissahickon' },
  { alias: 'moravian', teamId: 89, teamName: 'Moravian Academy' },
  { alias: 'wood', teamId: 59, teamName: 'Archbishop Wood' },
  { alias: 'barrack', teamId: 53, teamName: 'Jack Barrack' },
  { alias: 'jba', teamId: 53, teamName: 'Jack Barrack' },
  { alias: 'hill', teamId: 106, teamName: 'Hill School' },
  { alias: 'new hope', teamId: 10, teamName: 'New Hope-Solebury' },
  { alias: 'springfield-d', teamId: 37, teamName: 'Springfield-Delco' },
  { alias: 'd east', teamId: 43, teamName: 'Downingtown East' },
  { alias: 'perk school', teamId: 115, teamName: 'Perkiomen School' },
  { alias: 'shipley', teamId: 116, teamName: 'Shipley School' },
  { alias: 'west chester east', teamId: 188, teamName: 'West Chester East' },
  // Second batch — disambiguated by anomaly→game join (≥85% one team).
  { alias: 'pw', teamId: 61, teamName: 'Plymouth Whitemarsh' },
  { alias: 'hh', teamId: 100, teamName: 'Hatboro-Horsham' },
  { alias: 'lc', teamId: 186, teamName: 'Lansdale Catholic' },
  { alias: 'anc', teamId: 110, teamName: 'Academy of the New Church' },
  { alias: 'stoga', teamId: 33, teamName: 'Conestoga' },
  { alias: 'tvalley', teamId: 48, teamName: 'Twin Valley' },
  { alias: 'carroll', teamId: 94, teamName: 'Archbishop Carroll' },
  { alias: 'arch carroll', teamId: 94, teamName: 'Archbishop Carroll' },
  { alias: 'ag', teamId: 77, teamName: 'Avon Grove' },

  // ─── Wave 13 Lane 1 — section-only headers + remaining unambiguous abbrevs ──
  // Verified against live anomaly→game joins on 2026-04-22 (Chewy 🐻💪).
  // "Pburg" appears only in Easton vs Phillipsburg games → id 232.
  // "Solehi" appears only in Parkland vs Southern Lehigh games → id 87.
  { alias: 'pburg', teamId: 232, teamName: 'Phillipsburg' },
  { alias: 'solehi', teamId: 87, teamName: 'Southern Lehigh' },

  // ─── Wave 17 Lane 1 (Chewy 🐻💪) — Leia W16 schedule unresolved ────────
  // 15 raw schedule team names that failed schedule-team-resolve. Of those,
  // 9 map confidently to existing teams; the remaining 6 have no
  // corresponding teams row (out-of-coverage NJ/DE schools or
  // outside-Philly PA programs). The 6 are documented in
  // docs/2026-04-22-remaining-anomalies.md rather than seeded — leaving
  // them as schedule_games rows with null team_id is the intended outcome.
  // Aliases are written in normalized form (see normalizeTeamName).
  { alias: 'wilson high school (d3)', teamId: 29, teamName: 'Wilson' },
  { alias: "saint joseph's preparatory school", teamId: 108, teamName: "St. Joseph's Prep" },
  { alias: 'springfield twp.(m)', teamId: 174, teamName: 'Springfield Township' },
  { alias: 'springfield (delco)', teamId: 37, teamName: 'Springfield-Delco' },
  { alias: 'pennington prep school', teamId: 117, teamName: 'Pennington Prep (NJ)' },
  { alias: 'msgr bonner & abp prendergast', teamId: 279, teamName: 'Bonner-Prendie' },
  { alias: 'lawrenceville prep school', teamId: 249, teamName: 'Lawrenceville School' },
  { alias: 'easton area', teamId: 7, teamName: 'Easton' },
  { alias: 'conwell-egan catholic', teamId: 205, teamName: 'Conwell Egan' },
];

export const PARSER_ABBREV_SOURCE = 'parser-abbrev-w10';

// ─── Wave I-D (2026-04-24) — LaxNumbers high-confidence aliases ─────────
//
// Generated from .github/docs/2026-04-23-laxnumbers-aliases.csv. Only the
// entries with confidence_1 ≥ 0.95 are auto-seeded here — these are
// unambiguous typo/punctuation/whitespace variants of canonical team names
// in our dataset:
//
//   "Cardinal OHara"          → "Cardinal O'Hara"        (1.000, missing apostrophe)
//   "Plymouth-Whitemarsh"     → "Plymouth Whitemarsh"    (1.000, hyphen vs space)
//   "St Josephs Prep"         → "St. Joseph's Prep"      (1.000, missing punctuation)
//   "Schuylkill Valley"       → "Schuykill Valley"       (0.991, source typo in DB)
//   "Wilkes-Barre Area"       → "Wilkes Barre Area"      (1.000, hyphen vs space)
//   "Lawrenceville School Prep" → "Lawrenceville School" (0.950, redundant suffix)
//
// Aliases are written in normalized form (lowercased; whitespace collapsed).
// The remaining 96 mid/low-confidence rows in the CSV require human review
// before seeding — see the CSV's `reviewer_decision` column.
export const LAXNUMBERS_HIGH_CONF: readonly AliasMapping[] = [
  { alias: 'cardinal ohara', teamId: 65, teamName: "Cardinal O'Hara" },
  { alias: 'plymouth-whitemarsh', teamId: 61, teamName: 'Plymouth Whitemarsh' },
  { alias: 'st josephs prep', teamId: 108, teamName: "St. Joseph's Prep" },
  { alias: 'schuylkill valley', teamId: 257, teamName: 'Schuykill Valley' },
  { alias: 'wilkes-barre area', teamId: 210, teamName: 'Wilkes Barre Area' },
  { alias: 'lawrenceville school prep', teamId: 249, teamName: 'Lawrenceville School' },
];

export const LAXNUMBERS_HIGH_CONF_SOURCE = 'laxnumbers-high-conf-2026-04-24';

// ─── Wave I-E (2026-04-24) — LaxNumbers curated aliases ─────────────────
//
// The 96 mid/low-confidence rows from the same CSV were triaged by hand
// (combination of rule-based filters + PA HS lacrosse domain knowledge,
// see .github/docs/triage-laxnumbers*.py and the CSV's reviewer_decision
// column). 84 were rejected as out-of-region (Pittsburgh / Erie / York /
// Lancaster / Harrisburg / NEPA) or out-of-state. The 12 below are the
// curated ACCEPTs:
//
//   PA suffix convention ("X Area" → "X"):
//     "Nazareth Area"     → "Nazareth"
//     "Oxford Area"       → "Oxford"
//     "Northampton Area"  → "Northampton"
//
//   School renamed:
//     "Bayard Rustin"     → "WC Rustin"   (West Chester Rustin renamed in 2017)
//
//   City qualifier vs short form (Lehigh Valley schools):
//     "Freedom Bethlehem" → "Freedom"
//     "Liberty Bethlehem" → "Liberty"
//
//   Formal name vs short form / abbrev:
//     "Delaware County Christian" → "Delco Christian"
//     "Governor Mifflin"          → "Gov. Mifflin"
//     "La Salle College"          → "La Salle"   (La Salle College HS, Wyndmoor)
//     "West Chester Henderson"    → "WC Henderson"
//     "Bonner-Prendergast"        → "Bonner-Prendie"
//     "Church Farm School"        → "Church Farm"
//
// Aliases are written in normalized form (lowercased; whitespace collapsed).
export const LAXNUMBERS_CURATED_2026_04_24: readonly AliasMapping[] = [
  { alias: 'nazareth area', teamId: 22, teamName: 'Nazareth' },
  { alias: 'oxford area', teamId: 78, teamName: 'Oxford' },
  { alias: 'northampton area', teamId: 8, teamName: 'Northampton' },
  { alias: 'bayard rustin', teamId: 45, teamName: 'WC Rustin' },
  { alias: 'freedom bethlehem', teamId: 104, teamName: 'Freedom' },
  { alias: 'liberty bethlehem', teamId: 91, teamName: 'Liberty' },
  { alias: 'delaware county christian', teamId: 165, teamName: 'Delco Christian' },
  { alias: 'governor mifflin', teamId: 30, teamName: 'Gov. Mifflin' },
  { alias: 'la salle college', teamId: 58, teamName: 'La Salle' },
  { alias: 'west chester henderson', teamId: 41, teamName: 'WC Henderson' },
  { alias: 'bonner-prendergast', teamId: 279, teamName: 'Bonner-Prendie' },
  { alias: 'church farm school', teamId: 207, teamName: 'Church Farm' },
];

export const LAXNUMBERS_CURATED_2026_04_24_SOURCE = 'laxnumbers-curated-2026-04-24';

// Tokens deliberately NOT seeded — too ambiguous for a high-confidence
// alias. Parser will continue to log these as anomalies for manual triage.
export interface SkippedAmbiguousNote {
  token: string;
  rationale: string;
}

export const SKIPPED_AMBIGUOUS: readonly SkippedAmbiguousNote[] = [
  { token: 'bhs', rationale: 'Could be Boyertown, Bensalem, Bonner — multiple BHS schools in coverage area.' },
  { token: 'dv', rationale: 'Delaware Valley vs Downingtown Varsity vs Daniel Webster — no dominant signal in anomaly samples.' },
  { token: 'mr', rationale: 'Marple-Newtown? Methacton Reserves? Manor? Insufficient context to disambiguate.' },
  { token: 'ac', rationale: 'Archmere vs Avon Grove vs Athletic Club — sub-header context did not lean to any single team.' },
  { token: 'ag', rationale: 'Avon Grove vs Archbishop Goretti — both plausible PA programs, leave for manual triage.' },
  // ─── W11 (Chewy 🐻💪) — surfaced by suffix-strip but still ambiguous ───
  { token: 'prep', rationale: 'Malvern Prep vs SJP vs Holy Ghost Prep vs La Salle College Prep — context-dependent.' },
  { token: 'nhs', rationale: 'Could be New Hope-Solebury or Neshaminy — risk of mis-attribution to wrong NHS.' },
  // ─── W13 (Chewy 🐻💪) — Darth's hint list, but verification rejected ───
  { token: 'lc-extra', rationale: 'Already aliased to Lansdale Catholic in W11; Darth recommended Lower Merion but no anomaly samples support that — keep existing mapping.' },
  { token: 'pburg-extra', rationale: 'Darth suggested Phoenixville/Pottsville; live data shows the only "Pburg" usage is Phillipsburg (verified by anomaly→game join). Seeded id=232.' },
];

// ─── Wave 16 Lane 1 (Yoda 🧙‍♂️🟢) — UNMAPPABLE_PIAA ──────────────────────
//
// PIAA validation reconciliation pass. Baseline before this wave (live DB
// data/lacrosse.db on 2026-04-22, post-W15 dedup):
//
//   match     10
//   close     32
//   divergent 16
//   unmapped  159    (217 teams total)
//
// Investigation result: every active PIAA District 1 program (57 of 59) is
// already linked to a team row via the W6 PIAA_ALIASES seed or via a direct
// LOWER(t.name) = p.name_normalized match. The two PIAA rows that remain
// unlinked are inactive 0-0 programs with no corresponding team row in our
// dataset (Harry S. Truman, William Tennent — see W6 skip note above).
//
// The remaining "unmapped" teams are NOT naming mismatches. They fall into
// the categories below, none of which can ever map to a PIAA D1 row because
// PIAA D1 only covers PA public schools + a small set of catholic schools
// inside southeastern PA's District 1 footprint. All entries below were
// verified against the PIAA D1 official roster (piaa_official_teams) on
// 2026-04-22; none share a name_normalized with any PIAA D1 row.
//
// This list is documentary only — it is NOT seeded as aliases. The
// `unmapped` validation status is the correct, intended outcome for these
// teams. Tests in seedTeamAliases.test.ts assert that none of these names
// appear in the PIAA roster, so the doc stays in sync if PIAA expands.
export interface UnmappableNote {
  category: string;
  teamName: string;
  rationale: string;
}

export const UNMAPPABLE_PIAA: readonly UnmappableNote[] = [
  // ── Inter-Ac League (private day schools, Philly suburbs) ──────────────
  // The Inter-Academic League schools play their own championship; PIAA D1
  // does not include any private-school members. Validation status =
  // "unmapped" is correct for all of them.
  { category: 'inter-ac', teamName: 'Episcopal Academy', rationale: 'Private Inter-Ac school; PIAA D1 covers public + select catholic only.' },
  { category: 'inter-ac', teamName: 'Penn Charter', rationale: 'Private Inter-Ac school (William Penn Charter); not a PIAA D1 member.' },
  { category: 'inter-ac', teamName: 'Germantown Academy', rationale: 'Private Inter-Ac school; not a PIAA D1 member.' },
  { category: 'inter-ac', teamName: 'Haverford School', rationale: 'Private Inter-Ac school; distinct from PIAA "Haverford" (the public HS, id 36).' },
  { category: 'inter-ac', teamName: 'Malvern Prep', rationale: 'Private Inter-Ac school; not a PIAA D1 member.' },
  { category: 'inter-ac', teamName: 'Springside Chestnut Hill', rationale: 'Private Inter-Ac school; not a PIAA D1 member.' },

  // ── Philadelphia Catholic League (PCL) ─────────────────────────────────
  // Only the suburban catholic programs that compete in PIAA D1 brackets
  // (Bishop Shanahan, Holy Ghost Prep, Pope John Paul II, Lansdale Catholic,
  // Delco Christian) appear in the PIAA roster. The Philly-proper catholics
  // below run under PCL's own bracket and never appear in D1.
  { category: 'pcl', teamName: "Cardinal O'Hara", rationale: 'Philly Catholic League; not a PIAA D1 member.' },
  { category: 'pcl', teamName: 'Archbishop Wood', rationale: 'Philly Catholic League; not a PIAA D1 member.' },
  { category: 'pcl', teamName: 'Archbishop Ryan', rationale: 'Philly Catholic League; not a PIAA D1 member.' },
  { category: 'pcl', teamName: 'Archbishop Carroll', rationale: 'Philly Catholic League; not a PIAA D1 member.' },
  { category: 'pcl', teamName: "St. Joseph's Prep", rationale: 'Philly Catholic League; not a PIAA D1 member.' },
  { category: 'pcl', teamName: 'La Salle', rationale: 'Philly Catholic League (La Salle College HS); not a PIAA D1 member.' },
  { category: 'pcl', teamName: 'Roman Catholic', rationale: 'Philly Catholic League; not a PIAA D1 member.' },
  { category: 'pcl', teamName: 'Father Judge', rationale: 'Philly Catholic League; not a PIAA D1 member.' },
  { category: 'pcl', teamName: 'Conwell Egan', rationale: 'Philly Catholic League; not a PIAA D1 member.' },
  { category: 'pcl', teamName: 'Bonner-Prendie', rationale: 'Philly Catholic League (Monsignor Bonner-Archbishop Prendergast); not a PIAA D1 member.' },
  { category: 'pcl', teamName: 'Devon Prep', rationale: 'Catholic prep; not a PIAA D1 member (lacrosse plays independent schedule).' },

  // ── Other independent / boarding ──────────────────────────────────────
  { category: 'independent', teamName: 'Hill School', rationale: 'Boarding school (MAPL); not a PIAA D1 member.' },
  { category: 'independent', teamName: 'Perkiomen School', rationale: 'Boarding school; not a PIAA D1 member.' },
  { category: 'independent', teamName: 'Shipley School', rationale: 'Independent day school (Friends Schools League); not a PIAA D1 member.' },
  { category: 'independent', teamName: 'Westtown', rationale: 'Quaker boarding school (FSL); not a PIAA D1 member.' },
  { category: 'independent', teamName: 'Jack Barrack', rationale: 'Jack M. Barrack Hebrew Academy (FSL); not a PIAA D1 member.' },
  { category: 'independent', teamName: 'Academy of the New Church', rationale: 'Private religious day school (FSL); not a PIAA D1 member.' },
  { category: 'independent', teamName: 'Moravian Academy', rationale: 'Private day school (Lehigh Valley); not a PIAA D1 member.' },
  { category: 'independent', teamName: 'AIM Academy', rationale: 'Private day school; not a PIAA D1 member.' },

  // ── PA public schools outside District 1 ──────────────────────────────
  // PIAA boys lacrosse is district-bracketed; these programs play in D2/D3/
  // D11/D12 etc. and are correctly absent from the D1 roster.
  { category: 'non-d1-pa', teamName: 'Easton', rationale: 'D11 (Lehigh Valley); not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'Parkland', rationale: 'D11 (Lehigh Valley); not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'Wilson', rationale: 'D11 (Wilson Area, Easton); not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'Nazareth', rationale: 'D11 (Lehigh Valley); not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'Emmaus', rationale: 'D11 (Lehigh Valley); not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'Northampton', rationale: 'D11 (Lehigh Valley); not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'Liberty', rationale: 'D11 (Bethlehem); not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'Freedom', rationale: 'D11 (Bethlehem); not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'Southern Lehigh', rationale: 'D11; not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'Saucon Valley', rationale: 'D11; not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'Twin Valley', rationale: 'D3 (Berks); not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'Wyomissing', rationale: 'D3 (Berks); not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'Daniel Boone', rationale: 'D3 (Berks); not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'Abington Heights', rationale: 'D2 (NEPA); not a PIAA D1 program (distinct from D1\'s "Abington").' },
  { category: 'non-d1-pa', teamName: 'Scranton Prep', rationale: 'D2 (NEPA); not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'Delaware Valley', rationale: 'D2 (NEPA Pike County); not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'North Pocono', rationale: 'D2 (NEPA); not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'Crestwood', rationale: 'D2 (NEPA); not a PIAA D1 program.' },
  { category: 'non-d1-pa', teamName: 'Phillipsburg', rationale: 'NJ (Warren County); not a PIAA D1 program despite Easton-area scheduling.' },

  // ── Out-of-state opponents (NJ, NY, MD, DE, VA) ───────────────────────
  // Independent/private schools that show up via cross-border games. None
  // are PIAA-eligible.
  { category: 'out-of-state', teamName: "St. Anthony's (NY)", rationale: 'NY private; cross-border opponent. Not PIAA-eligible.' },
  { category: 'out-of-state', teamName: 'Pennington (NJ)', rationale: 'NJ private; cross-border opponent. Not PIAA-eligible.' },
  { category: 'out-of-state', teamName: 'Episcopal', rationale: 'Episcopal HS (Alexandria, VA). Distinct from PA Episcopal Academy.' },
  { category: 'out-of-state', teamName: 'Loyola Blakefield', rationale: 'MD (MIAA-A); cross-border opponent. Not PIAA-eligible.' },
  { category: 'out-of-state', teamName: 'Blair Academy', rationale: 'NJ boarding (MAPL); cross-border opponent. Not PIAA-eligible.' },
  { category: 'out-of-state', teamName: 'Bergen Catholic (NJ)', rationale: 'NJ catholic; cross-border opponent. Not PIAA-eligible.' },

  // ── Team-row duplicates awaiting dedup (W15 Lane 2 / future wave) ──────
  // Aliasing cannot fix these — the alias UNIQUE constraint blocks pointing
  // a PIAA name at two teams. The fix is to merge the dup into the canonical
  // row via dedupTeams.ts. Listed here so the next dedup pass has a hit list.
  //
  // RESOLVED in Wave 17 Lane 1 (Chewy 🐻💪) — all 13 entries below were
  // merged via dedupTeams.ts EXPLICIT_PAIRS. Kept in this list as historical
  // documentation of the divergent → merged transitions (the merged-from
  // ids no longer exist in `teams`, so the entries are functionally inert
  // but useful for plan-log auditing). The dup-needs-merge category is
  // skipped by the UNMAPPABLE_PIAA / PIAA-collision test by design.
  { category: 'dup-needs-merge', teamName: 'Spring Ford (id 355)', rationale: 'Dup of "Spring-Ford" (id 1). Canonical already aliased "springford" → 1.' },
  { category: 'dup-needs-merge', teamName: 'Springfield-Montco (id 97)', rationale: 'Dup of "Springfield Township" (id 174, holds "springfield twp" alias). Merging 97 into 174 would lift id 174 from divergent (0-0 vs 4-7) → close.' },
  { category: 'dup-needs-merge', teamName: 'Springfield-M (id 266)', rationale: 'Same school as id 97/174 — third spelling variant. Merge into 174.' },
  { category: 'dup-needs-merge', teamName: 'CB East (id 157)', rationale: 'Dup of "Central Bucks East" (id 69). LOWER name matches PIAA "cb east" directly, so it appears divergent (1-2 vs 6-7). Merge into 69.' },
  { category: 'dup-needs-merge', teamName: 'Henderson (id 462)', rationale: 'Dup of "WC Henderson" (id 41).' },
  { category: 'dup-needs-merge', teamName: "St. Joe's Prep (id 217)", rationale: 'Dup of "St. Joseph\'s Prep" (id 108).' },
  { category: 'dup-needs-merge', teamName: 'U Darby (id 271)', rationale: 'Dup of "Upper Darby" (id 20).' },
  { category: 'dup-needs-merge', teamName: 'Arch Carroll (id 304)', rationale: 'Dup of "Archbishop Carroll" (id 94).' },
  { category: 'dup-needs-merge', teamName: 'Academy New Church (id 301)', rationale: 'Dup of "Academy of the New Church" (id 110).' },
  { category: 'dup-needs-merge', teamName: 'Bonner Prendie (id 403)', rationale: 'Dup of "Bonner-Prendie" (id 279).' },
  { category: 'dup-needs-merge', teamName: 'S. Lehigh (id 262)', rationale: 'Dup of "Southern Lehigh" (id 87).' },
  { category: 'dup-needs-merge', teamName: 'Manheim Twp. (id 250)', rationale: 'Dup of "Manheim Township" (id 127).' },
  { category: 'dup-needs-merge', teamName: 'Lake Lehman (id 361)', rationale: 'Dup of "Lake-Lehman" (id 239); neither in PIAA D1.' },

  // ── Junk team rows (parser leakage; cleanup belongs to ghost-cleanup) ──
  { category: 'parser-junk', teamName: 'Saves for Abington Colton Naholnik (id 25)', rationale: 'Player-row leakage; should be deleted by cleanGhostTeams not aliased.' },
  { category: 'parser-junk', teamName: 'Dylan Bellas (id 26)', rationale: 'Player-row leakage; should be deleted by cleanGhostTeams not aliased.' },
  { category: 'parser-junk', teamName: 'Halftime R (id 461)', rationale: 'Live-blog header leakage; should be deleted.' },
  { category: 'parser-junk', teamName: 'Halftime – EA (id 323)', rationale: 'Live-blog header leakage; should be deleted.' },
  { category: 'parser-junk', teamName: 'South Philly (id 298)', rationale: 'Live-blog placeholder; not a real team row.' },
];

export interface SeedResult {
  inserted: number;
  alreadyPresent: number;
  /** Aliases referencing a team_id that doesn't exist (defensive: 0 expected). */
  missingTeam: AliasMapping[];
}

/**
 * Idempotent insert. Returns counts split by outcome. Any mapping whose
 * team_id is missing from the teams table is reported (not inserted) so the
 * operator can investigate without crashing the run.
 */
export function seedAliases(
  db: Database,
  mappings: readonly AliasMapping[] = PIAA_ALIASES,
  source: string = ALIAS_SOURCE,
): SeedResult {
  const teamExists = db.prepare('SELECT 1 FROM teams WHERE id = ?');
  const insert = db.prepare(
    `INSERT OR IGNORE INTO team_aliases (alias, team_id, source, confidence)
       VALUES (?, ?, ?, 1.0)`,
  );

  let inserted = 0;
  let alreadyPresent = 0;
  const missingTeam: AliasMapping[] = [];

  const tx = db.transaction(() => {
    for (const m of mappings) {
      if (!teamExists.get(m.teamId)) {
        missingTeam.push(m);
        continue;
      }
      const info = insert.run(m.alias, m.teamId, source);
      if (info.changes === 1) inserted += 1;
      else alreadyPresent += 1;
    }
  });
  tx();

  return { inserted, alreadyPresent, missingTeam };
}

function printResult(result: SeedResult, apply: boolean): void {
  const header = apply ? 'Applied' : 'Dry-run plan';
  log.info(`-------- ${header}: seedTeamAliases --------`);
  log.info(`inserted:        ${result.inserted}`);
  log.info(`already present: ${result.alreadyPresent}`);
  if (result.missingTeam.length > 0) {
    log.info(`!! missing team rows (skipped): ${result.missingTeam.length}`);
    for (const m of result.missingTeam) {
      log.info(`    alias="${m.alias}" -> team_id=${m.teamId} (${m.teamName})`);
    }
  }
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const here = dirname(fileURLToPath(import.meta.url));
  const defaultDb = resolve(here, '..', '..', '..', '..', 'data', 'lacrosse.db');
  const dbPath = process.env.DB_PATH ?? defaultDb;
  log.info(`[seedTeamAliases] opening ${dbPath} (${apply ? 'APPLY' : 'dry-run'})`);

  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  const groups: Array<{
    label: string;
    mappings: readonly AliasMapping[];
    source: string;
  }> = [
    { label: 'PIAA_ALIASES', mappings: PIAA_ALIASES, source: ALIAS_SOURCE },
    { label: 'PARSER_ABBREVIATIONS', mappings: PARSER_ABBREVIATIONS, source: PARSER_ABBREV_SOURCE },
    { label: 'LAXNUMBERS_HIGH_CONF', mappings: LAXNUMBERS_HIGH_CONF, source: LAXNUMBERS_HIGH_CONF_SOURCE },
    { label: 'LAXNUMBERS_CURATED_2026_04_24', mappings: LAXNUMBERS_CURATED_2026_04_24, source: LAXNUMBERS_CURATED_2026_04_24_SOURCE },
  ];

  if (!apply) {
    for (const g of groups) {
      const placeholders = g.mappings.map(() => '?').join(',');
      const present = db
        .prepare(`SELECT alias FROM team_aliases WHERE alias IN (${placeholders})`)
        .all(...g.mappings.map((m) => m.alias)) as Array<{ alias: string }>;
      const presentSet = new Set(present.map((r) => r.alias));
      const wouldInsert = g.mappings.filter((m) => !presentSet.has(m.alias));
      log.info(`-------- Dry-run plan: ${g.label} --------`);
      log.info(`would insert: ${wouldInsert.length} / ${g.mappings.length}`);
      for (const m of wouldInsert) {
        log.info(`  + alias="${m.alias}" -> team_id=${m.teamId} (${m.teamName})`);
      }
    }
    log.info(`\nSKIPPED_AMBIGUOUS (documented, not seeded): ${SKIPPED_AMBIGUOUS.length}`);
    for (const s of SKIPPED_AMBIGUOUS) {
      log.info(`  · ${s.token} — ${s.rationale}`);
    }
    const byCategory = new Map<string, number>();
    for (const u of UNMAPPABLE_PIAA) {
      byCategory.set(u.category, (byCategory.get(u.category) ?? 0) + 1);
    }
    log.info(`\nUNMAPPABLE_PIAA (documented non-PIAA-D1 teams): ${UNMAPPABLE_PIAA.length}`);
    for (const [cat, n] of byCategory) {
      log.info(`  · ${cat}: ${n}`);
    }
    log.info('\n(Dry-run only. Re-run with --apply to write.)');
    db.close();
    return;
  }

  for (const g of groups) {
    const result = seedAliases(db, g.mappings, g.source);
    printResult(result, apply);
    log.info(`(group: ${g.label}, source: ${g.source})\n`);
  }

  const total = (db.prepare('SELECT COUNT(*) AS n FROM team_aliases').get() as { n: number }).n;
  log.info(`team_aliases total: ${total}`);
  db.close();
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
