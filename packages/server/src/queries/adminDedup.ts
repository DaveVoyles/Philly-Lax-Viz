import type { Database } from 'better-sqlite3';

export interface DedupCandidateRow {
  id: number;
  player_a_id: number;
  player_a_name: string;
  player_a_team: string;
  player_a_stats: number;
  player_b_id: number;
  player_b_name: string;
  player_b_team: string;
  player_b_stats: number;
  similarity: number;
  algo: string;
  status: string;
  reviewer_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}

interface ListDedupCandidatesOptions {
  status?: string;
  limit?: number;
  offset?: number;
}

interface DedupCandidatePairRow {
  player_a_id: number;
  player_b_id: number;
  player_b_name: string;
}

const CANDIDATE_SELECT = `SELECT
  dc.id,
  dc.player_a_id,
  pa.name AS player_a_name,
  ta.name AS player_a_team,
  (SELECT COUNT(*) FROM player_stats WHERE player_id = dc.player_a_id) AS player_a_stats,
  dc.player_b_id,
  pb.name AS player_b_name,
  tb.name AS player_b_team,
  (SELECT COUNT(*) FROM player_stats WHERE player_id = dc.player_b_id) AS player_b_stats,
  dc.similarity,
  dc.algo,
  dc.status,
  dc.reviewer_notes,
  dc.created_at,
  dc.reviewed_at
FROM dedup_candidates dc
JOIN players pa ON pa.id = dc.player_a_id
JOIN teams ta ON ta.id = pa.team_id
JOIN players pb ON pb.id = dc.player_b_id
JOIN teams tb ON tb.id = pb.team_id`;

export function listDedupCandidates(
  db: Database,
  { status, limit = 50, offset = 0 }: ListDedupCandidatesOptions = {},
): DedupCandidateRow[] {
  return db.prepare(
    `${CANDIDATE_SELECT}
     WHERE (? IS NULL OR dc.status = ?)
     ORDER BY dc.similarity DESC
     LIMIT ? OFFSET ?`,
  ).all(status ?? null, status ?? null, limit, offset) as DedupCandidateRow[];
}

export function getDedupCandidate(db: Database, id: number): DedupCandidateRow | null {
  return (db.prepare(
    `${CANDIDATE_SELECT}
     WHERE dc.id = ?`,
  ).get(id) as DedupCandidateRow | undefined) ?? null;
}

export function updateDedupCandidate(
  db: Database,
  id: number,
  { status, reviewer_notes }: { status: string; reviewer_notes?: string },
): void {
  db.prepare(
    `UPDATE dedup_candidates
     SET status = ?,
         reviewer_notes = ?,
         reviewed_at = datetime('now')
     WHERE id = ?`,
  ).run(status, reviewer_notes ?? null, id);
}

export function mergeDedupCandidate(
  db: Database,
  candidateId: number,
): { statsRedirected: number; statsDropped: number } {
  const mergeTx = db.transaction((id: number) => {
    const candidate = db.prepare(
      `SELECT dc.player_a_id, dc.player_b_id, pb.name AS player_b_name
       FROM dedup_candidates dc
       JOIN players pb ON pb.id = dc.player_b_id
       WHERE dc.id = ?`,
    ).get(id) as DedupCandidatePairRow | undefined;

    if (!candidate) {
      throw new Error(`Dedup candidate ${id} not found`);
    }

    const redirectResult = db.prepare(
      'UPDATE OR IGNORE player_stats SET player_id = ? WHERE player_id = ?',
    ).run(candidate.player_a_id, candidate.player_b_id);

    const remainingStats = (
      db.prepare('SELECT COUNT(*) AS c FROM player_stats WHERE player_id = ?').get(candidate.player_b_id) as {
        c: number;
      }
    ).c;

    if (remainingStats > 0) {
      db.prepare('DELETE FROM player_stats WHERE player_id = ?').run(candidate.player_b_id);
    }

    db.prepare(
      `INSERT OR IGNORE INTO player_aliases (alias, player_id, source, confidence)
       VALUES (?, ?, 'admin-dedup', 1.0)`,
    ).run(candidate.player_b_name, candidate.player_a_id);

    db.prepare('DELETE FROM players WHERE id = ?').run(candidate.player_b_id);
    db.prepare(
      `UPDATE dedup_candidates
       SET status = 'approved',
           reviewed_at = datetime('now')
       WHERE id = ?`,
    ).run(id);

    return {
      statsRedirected: Number(redirectResult.changes),
      statsDropped: remainingStats,
    };
  });

  return mergeTx(candidateId);
}
