/**
 * Audit + backfill for impossible per-game stat values caused by parser
 * over-greediness on parenthetical career milestones (e.g. "1G (Set School
 * record 173 Goals)" parsing as 174 goals).
 *
 * For each player_stats row that exceeds realistic single-game caps:
 *  - record an `ingest_anomalies` row with strategy `stat-cap-exceeded`
 *  - clamp the offending column(s) to 0
 *  - if the row becomes entirely empty (no remaining stats), DELETE the row
 *
 * Also strips trailing `:` `;` `,` from player names that snuck through the
 * older parser (94 known rows as of 2026-04-22).
 *
 * Idempotent. Run with `--apply` to commit; otherwise prints a dry-run.
 *
 * Usage:
 *   DB_PATH=./data/lacrosse.db pnpm --filter @pll/ingest exec tsx \
 *     src/scripts/auditStatAnomalies.ts [--apply]
 */
import Database from 'better-sqlite3';
import { resolve } from 'node:path';

import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:auditStatAnomalies' });
const STAT_CAPS: Record<string, number> = {
  goals: 15,
  assists: 15,
  ground_balls: 30,
  caused_turnovers: 20,
  saves: 40,
  fo_won: 40,
  fo_taken: 50,
};

interface Row {
  id: number;
  game_id: number;
  player_id: number;
  goals: number;
  assists: number;
  ground_balls: number;
  caused_turnovers: number;
  saves: number;
  fo_won: number;
  fo_taken: number;
  player_name: string;
  source_post_id: string;
  recap_url: string | null;
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const dbPath = process.env.DB_PATH ?? './data/lacrosse.db';
  const db = new Database(resolve(dbPath));
  db.pragma('journal_mode = DELETE');
  db.pragma('foreign_keys = ON');

  const overCapRows = db
    .prepare(
      `SELECT ps.id, ps.game_id, ps.player_id, ps.goals, ps.assists,
              ps.ground_balls, ps.caused_turnovers, ps.saves, ps.fo_won, ps.fo_taken,
              p.name AS player_name, g.source_post_id, g.recap_url
         FROM player_stats ps
         JOIN players p ON p.id = ps.player_id
         JOIN games   g ON g.id = ps.game_id
        WHERE ps.goals > ${STAT_CAPS.goals}
           OR ps.assists > ${STAT_CAPS.assists}
           OR ps.ground_balls > ${STAT_CAPS.ground_balls}
           OR ps.caused_turnovers > ${STAT_CAPS.caused_turnovers}
           OR ps.saves > ${STAT_CAPS.saves}
           OR ps.fo_won > ${STAT_CAPS.fo_won}
           OR ps.fo_taken > ${STAT_CAPS.fo_taken}`,
    )
    .all() as Row[];

  log.info(`[audit] found ${overCapRows.length} player_stats rows above caps`);

  // 2. trailing-punctuation player names
  const colonNames = db
    .prepare(
      `SELECT id, name FROM players
        WHERE name LIKE '%:'
           OR name LIKE '%;'
           OR name LIKE '%,'
           OR name LIKE '% '
           OR name LIKE '%.'
           OR name LIKE '%, goalie'
           OR name LIKE '%, goalie,'`,
    )
    .all() as Array<{ id: number; name: string }>;
  log.info(`[audit] found ${colonNames.length} players with trailing punctuation in name`);

  if (!apply) {
    for (const r of overCapRows.slice(0, 20)) {
      log.info(
        `  over-cap: id=${r.id} player=${r.player_name} g=${r.goals} a=${r.assists} sv=${r.saves}`,
      );
    }
    for (const p of colonNames.slice(0, 20)) {
      log.info(`  bad-name: id=${p.id} name=${JSON.stringify(p.name)}`);
    }
    log.info('[audit] DRY RUN — pass --apply to commit changes');
    return;
  }

  const insertAnomaly = db.prepare(
    `INSERT INTO ingest_anomalies
       (source_post_id, source_url, raw_line, parent_game_id, strategy_attempted, reason, created_at)
     VALUES (?, ?, ?, ?, 'stat-cap-exceeded', ?, datetime('now'))`,
  );
  const updateStats = db.prepare(
    `UPDATE player_stats
        SET goals = MIN(goals, ?), assists = MIN(assists, ?),
            ground_balls = MIN(ground_balls, ?),
            caused_turnovers = MIN(caused_turnovers, ?),
            saves = MIN(saves, ?), fo_won = MIN(fo_won, ?), fo_taken = MIN(fo_taken, ?)
      WHERE id = ?`,
  );
  // After clamping, if everything is zero, delete the row.
  const deleteEmpty = db.prepare(
    `DELETE FROM player_stats
      WHERE id = ?
        AND goals = 0 AND assists = 0 AND ground_balls = 0
        AND caused_turnovers = 0 AND saves = 0 AND fo_won = 0 AND fo_taken = 0`,
  );
  const updateName = db.prepare(`UPDATE players SET name = ? WHERE id = ?`);

  // Re-clamp: replace each over-cap stat with 0 (not the cap value) since the
  // raw value is untrustworthy. Then drop the row if everything is 0.
  const clampStats = db.prepare(
    `UPDATE player_stats
        SET goals = CASE WHEN goals > ? THEN 0 ELSE goals END,
            assists = CASE WHEN assists > ? THEN 0 ELSE assists END,
            ground_balls = CASE WHEN ground_balls > ? THEN 0 ELSE ground_balls END,
            caused_turnovers = CASE WHEN caused_turnovers > ? THEN 0 ELSE caused_turnovers END,
            saves = CASE WHEN saves > ? THEN 0 ELSE saves END,
            fo_won = CASE WHEN fo_won > ? THEN 0 ELSE fo_won END,
            fo_taken = CASE WHEN fo_taken > ? THEN 0 ELSE fo_taken END
      WHERE id = ?`,
  );

  const tx = db.transaction(() => {
    let clamped = 0;
    let deleted = 0;
    for (const r of overCapRows) {
      const reasons: string[] = [];
      for (const [col, cap] of Object.entries(STAT_CAPS)) {
        const v = (r as unknown as Record<string, number>)[col] ?? 0;
        if (v > cap) reasons.push(`${col}=${v}>${cap}`);
      }
      insertAnomaly.run(
        r.source_post_id,
        r.recap_url ?? '',
        `${r.player_name} (player_stats id=${r.id}, game_id=${r.game_id})`,
        r.game_id,
        `clamped to 0: ${reasons.join(', ')}`,
      );
      clampStats.run(
        STAT_CAPS.goals,
        STAT_CAPS.assists,
        STAT_CAPS.ground_balls,
        STAT_CAPS.caused_turnovers,
        STAT_CAPS.saves,
        STAT_CAPS.fo_won,
        STAT_CAPS.fo_taken,
        r.id,
      );
      const result = deleteEmpty.run(r.id);
      if (result.changes > 0) deleted++;
      else clamped++;
    }
    let renamed = 0;
    for (const p of colonNames) {
      // Strip trailing junk: ":", ";", ",", whitespace, and known role suffixes
      // like ", goalie" / ", G" that snuck in via parser misalignment.
      let cleaned = p.name.trim();
      cleaned = cleaned.replace(/[\s,:;]+$/u, '').trim();
      cleaned = cleaned.replace(/,\s*goalie$/i, '').trim();
      cleaned = cleaned.replace(/[\s,:;]+$/u, '').trim();
      // Strip trailing dot UNLESS preceded by:
      //   - a single uppercase letter ("T.J." stays)
      //   - a known suffix Jr/Sr/II/III ("Phillip Leslie Jr." stays)
      const SUFFIX_RE = /\b(?:Jr|Sr|II|III|IV)\.$/u;
      if (!SUFFIX_RE.test(cleaned)) {
        cleaned = cleaned.replace(/(?<![A-Z])\.+$/u, '').trim();
      }
      if (cleaned && cleaned !== p.name) {
        // Guard against same-team duplicate after rename.
        const existing = db
          .prepare(
            `SELECT id FROM players WHERE name = ? AND team_id = (SELECT team_id FROM players WHERE id = ?) AND id != ?`,
          )
          .get(cleaned, p.id, p.id) as { id: number } | undefined;
        if (existing) {
          log.info(`  SKIP rename ${p.id} (${p.name}) → would collide with player ${existing.id}`);
          continue;
        }
        updateName.run(cleaned, p.id);
        renamed++;
      }
    }
    log.info(`[audit] clamped ${clamped} rows, deleted ${deleted} empty rows, renamed ${renamed} players`);
  });
  tx();

  // Suppress unused warning — kept for potential future callers.
  void updateStats;

  log.info('[audit] done');
}

main();
