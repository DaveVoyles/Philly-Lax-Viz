// schedule.ts — pipeline: parsed schedule rows → DB. Resolves team names
// via `findTeamByName` (lookup-only; we never insert ghost teams from the
// schedule source). Unresolved rows still get stored — `home_team_id` and
// `away_team_id` are nullable, and the raw names are kept for display +
// future re-resolution after alias seeding.

import type { Database } from 'better-sqlite3';
import { findTeamByName } from './teamResolver.js';
import { insertAnomaly } from './anomalies.js';
import type { ScheduleCsvRow } from '../parsers/scheduleCsv.js';

export interface IngestScheduleInput {
  source: string;            // e.g. 'piaa-d1'
  sourceUrl: string;
  season: number;
  rows: ScheduleCsvRow[];
}

export interface IngestScheduleResult {
  scheduleRowsUpserted: number;
  scheduleRowsSkippedCompleted: number;
  homeUnresolved: number;
  awayUnresolved: number;
  anomaliesAdded: number;
}

export function ingestScheduleRows(
  db: Database,
  input: IngestScheduleInput,
): IngestScheduleResult {
  const result: IngestScheduleResult = {
    scheduleRowsUpserted: 0,
    scheduleRowsSkippedCompleted: 0,
    homeUnresolved: 0,
    awayUnresolved: 0,
    anomaliesAdded: 0,
  };

  // Replace any prior rows from this source for this season so re-runs
  // produce a fresh snapshot — schedules drift (postponements, time
  // changes) and we don't want stale entries to linger.
  db.prepare(
    `DELETE FROM schedule_games WHERE source = ? AND season = ?`,
  ).run(input.source, input.season);

  const insert = db.prepare(
    `INSERT INTO schedule_games
       (home_team_id, away_team_id, home_team_name_raw, away_team_name_raw,
        game_date, game_time, location, source, source_url, season, scraped_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
     ON CONFLICT(home_team_id, away_team_id, game_date, source) DO UPDATE SET
       home_team_name_raw = excluded.home_team_name_raw,
       away_team_name_raw = excluded.away_team_name_raw,
       source_url         = excluded.source_url,
       scraped_at         = excluded.scraped_at`,
  );

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const seenUnresolvedTeams = new Set<string>();
    for (const row of input.rows) {
      if (row.completed) {
        result.scheduleRowsSkippedCompleted += 1;
        continue;
      }
      const home = findTeamByName(db, row.homeTeamRaw);
      const away = findTeamByName(db, row.awayTeamRaw);
      if (!home) {
        result.homeUnresolved += 1;
        if (!seenUnresolvedTeams.has(row.homeTeamRaw)) {
          seenUnresolvedTeams.add(row.homeTeamRaw);
          insertAnomaly(db, {
            sourcePostId: `schedule:${input.source}:${input.season}`,
            sourceUrl: input.sourceUrl,
            rawLine: row.homeTeamRaw,
            parentGameId: null,
            strategyAttempted: 'schedule-team-resolve',
            reason: 'schedule home team did not resolve to known teams (alias needed)',
          });
          result.anomaliesAdded += 1;
        }
      }
      if (!away) {
        result.awayUnresolved += 1;
        if (!seenUnresolvedTeams.has(row.awayTeamRaw)) {
          seenUnresolvedTeams.add(row.awayTeamRaw);
          insertAnomaly(db, {
            sourcePostId: `schedule:${input.source}:${input.season}`,
            sourceUrl: input.sourceUrl,
            rawLine: row.awayTeamRaw,
            parentGameId: null,
            strategyAttempted: 'schedule-team-resolve',
            reason: 'schedule away team did not resolve to known teams (alias needed)',
          });
          result.anomaliesAdded += 1;
        }
      }

      insert.run(
        home?.id ?? null,
        away?.id ?? null,
        row.homeTeamRaw,
        row.awayTeamRaw,
        row.date,
        input.source,
        input.sourceUrl,
        input.season,
        now,
      );
      result.scheduleRowsUpserted += 1;
    }
  });
  tx();

  return result;
}
