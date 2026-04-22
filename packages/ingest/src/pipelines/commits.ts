// commits.ts — pipeline: parsed commits → `commits` table.
//
// Wave 15 Lane 3 (Han 🧑‍🚀🍔). Resolves player + high-school references
// where possible (fuzzy via existing helpers) but keeps the row even when
// resolution fails — the raw player/college pair is the source of truth.
// Idempotent on (player_name_raw, college).

import type { Database } from 'better-sqlite3';
import type { ParsedCommit } from '../parsers/commitsPost.js';
import { findTeamByName } from './teamResolver.js';
import { normalizePlayerName } from '../normalize/playerName.js';
import { insertAnomaly } from './anomalies.js';

export interface IngestCommitsInput {
  postId: string;
  postUrl: string;
  postDate: string;
  commits: ParsedCommit[];
  anomalies: Array<{ rawLine: string; strategyAttempted: 'commits-list' | 'commits-profile'; reason: string }>;
}

export interface IngestCommitsResult {
  commitsUpserted: number;
  commitsResolvedPlayer: number;
  commitsResolvedHs: number;
  anomaliesAdded: number;
}

interface PlayerRow {
  id: number;
  team_id: number;
}

/**
 * Find an existing player by normalized name, optionally constrained to a
 * specific HS team_id. Falls back to any team when team_id is null and the
 * name normalizes to exactly one player across the DB.
 */
function resolvePlayer(
  db: Database,
  rawName: string,
  hsTeamId: number | null,
): number | null {
  const norm = normalizePlayerName(rawName);
  if (!norm) return null;

  if (hsTeamId !== null) {
    const direct = db
      .prepare('SELECT id, team_id FROM players WHERE name_normalized = ? AND team_id = ?')
      .get(norm, hsTeamId) as PlayerRow | undefined;
    if (direct) return direct.id;
  }

  // Cross-team lookup: only resolve if a single match exists. Multiple
  // matches → ambiguous, return null and let caller leave player_id NULL.
  const candidates = db
    .prepare('SELECT id, team_id FROM players WHERE name_normalized = ?')
    .all(norm) as PlayerRow[];
  if (candidates.length === 1) return candidates[0]!.id;

  // Last-ditch: alias table (player_aliases.alias is normalized text).
  try {
    const alias = db
      .prepare('SELECT player_id FROM player_aliases WHERE alias = ?')
      .get(norm) as { player_id: number } | undefined;
    if (alias) return alias.player_id;
  } catch {
    // player_aliases may not exist on very old DBs — ignore.
  }
  return null;
}

export function ingestCommitsPost(
  db: Database,
  input: IngestCommitsInput,
): IngestCommitsResult {
  let upserted = 0;
  let resolvedPlayer = 0;
  let resolvedHs = 0;
  let anomaliesAdded = 0;

  const insert = db.prepare(
    `INSERT INTO commits
       (player_id, player_name_raw, high_school_team_id, college,
        division, announced_date, source_post_id, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(player_name_raw, college) DO UPDATE SET
       player_id           = COALESCE(excluded.player_id, commits.player_id),
       high_school_team_id = COALESCE(excluded.high_school_team_id, commits.high_school_team_id),
       division            = COALESCE(excluded.division, commits.division),
       announced_date      = COALESCE(excluded.announced_date, commits.announced_date),
       source_post_id      = excluded.source_post_id,
       source_url          = excluded.source_url`,
  );

  for (const c of input.commits) {
    let hsTeamId: number | null = null;
    if (c.highSchool) {
      const team = findTeamByName(db, c.highSchool);
      if (team) {
        hsTeamId = team.id;
        resolvedHs++;
      }
    }
    const playerId = resolvePlayer(db, c.playerNameRaw, hsTeamId);
    if (playerId !== null) resolvedPlayer++;

    insert.run(
      playerId,
      c.playerNameRaw,
      hsTeamId,
      c.college,
      c.division,
      c.announcedDate ?? input.postDate,
      input.postId,
      input.postUrl,
    );
    upserted++;
  }

  for (const a of input.anomalies) {
    insertAnomaly(db, {
      sourcePostId: input.postId,
      sourceUrl: input.postUrl,
      rawLine: a.rawLine,
      parentGameId: null,
      strategyAttempted: a.strategyAttempted,
      reason: a.reason,
    });
    anomaliesAdded++;
  }

  return {
    commitsUpserted: upserted,
    commitsResolvedPlayer: resolvedPlayer,
    commitsResolvedHs: resolvedHs,
    anomaliesAdded,
  };
}
