import { existsSync } from 'node:fs';
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Database as DatabaseType } from 'better-sqlite3';
import { createLogger } from '@pll/shared';

import { openDb } from '../db.js';

const log = createLogger({ name: 'ingest:applyCorrections' });

export const FIELD_BOUNDS: Record<string, { hardCap: number; maxMultiplier?: number }> = {
  goals: { hardCap: 15, maxMultiplier: 5 },
  assists: { hardCap: 15, maxMultiplier: 5 },
  ground_balls: { hardCap: 30 },
  caused_turnovers: { hardCap: 20 },
  saves: { hardCap: 40 },
  fo_won: { hardCap: 40 },
  fo_taken: { hardCap: 50 },
  home_score: { hardCap: 30, maxMultiplier: 10 },
  away_score: { hardCap: 30, maxMultiplier: 10 },
};

export const PLAYER_ALLOWED_FIELDS = ['name', 'jersey_number'];

export const ALLOWED_FIELDS: Record<string, string[]> = {
  player_stat: ['goals', 'assists', 'ground_balls', 'caused_turnovers', 'saves', 'fo_won', 'fo_taken'],
  game: ['home_score', 'away_score'],
  player: PLAYER_ALLOWED_FIELDS,
};

interface CorrectionRow {
  id: number;
  entity_type: string;
  entity_id: number;
  field_name: string;
  new_value: string;
}

interface ApplyCorrectionsOptions {
  dryRun?: boolean;
}

interface ApplyCorrectionsSummary {
  approved: number;
  outliers: number;
  rejected: number;
  dryRun: number;
}

interface EntityTarget {
  tableName: 'player_stats' | 'games' | 'players';
}

export function isOutlier(
  fieldName: string,
  newValue: number | string,
  currentValue: number | string,
): boolean {
  if (fieldName === 'name') {
    return typeof newValue !== 'string' || newValue.trim() === '' || newValue.length > 100;
  }
  if (fieldName === 'jersey_number') {
    const jerseyNumber = typeof newValue === 'number' ? newValue : Number.parseInt(newValue, 10);
    return Number.isNaN(jerseyNumber) || jerseyNumber < 0 || jerseyNumber > 99;
  }

  const bounds = FIELD_BOUNDS[fieldName];
  if (!bounds || typeof newValue !== 'number' || typeof currentValue !== 'number') return false;
  if (newValue > bounds.hardCap) return true;
  if (bounds.maxMultiplier && currentValue > 0 && newValue / currentValue > bounds.maxMultiplier) {
    return true;
  }
  return false;
}

function parseArgs(argv: string[]): { dbPath: string; dryRun: boolean } {
  const dryRun = argv.includes('--dry-run');
  const dbArg = argv.find((arg) => arg.startsWith('--db='));
  if (!dbArg) {
    throw new Error('Missing required --db=<path> argument');
  }
  return { dbPath: dbArg.slice('--db='.length), dryRun };
}

function resolveDbPath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) return inputPath;
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const repoRelative = resolve(repoRoot, inputPath);
  if (existsSync(repoRelative)) return repoRelative;
  return resolve(inputPath);
}

function getEntityTarget(entityType: string): EntityTarget | null {
  if (entityType === 'player_stat') return { tableName: 'player_stats' };
  if (entityType === 'game') return { tableName: 'games' };
  if (entityType === 'player') return { tableName: 'players' };
  return null;
}

function allowedField(entityType: string, fieldName: string): boolean {
  return ALLOWED_FIELDS[entityType]?.includes(fieldName) ?? false;
}

function updateCorrectionStatus(
  db: DatabaseType,
  id: number,
  status: 'approved' | 'rejected' | 'outlier',
  reviewerNotes: string,
): void {
  db.prepare(
    `UPDATE community_corrections
        SET status = ?, reviewed_at = datetime('now'), reviewer_notes = ?
      WHERE id = ?`,
  ).run(status, reviewerNotes, id);
}

function rejectCorrection(
  db: DatabaseType,
  row: CorrectionRow,
  summary: ApplyCorrectionsSummary,
  dryRun: boolean,
  reason: string,
): void {
  summary.rejected += 1;
  if (dryRun) {
    log.info({ correctionId: row.id, reason }, 'dry-run would reject correction');
    return;
  }
  updateCorrectionStatus(db, row.id, 'rejected', reason);
}

function flagOutlier(
  db: DatabaseType,
  row: CorrectionRow,
  summary: ApplyCorrectionsSummary,
  dryRun: boolean,
  reason: string,
): void {
  summary.outliers += 1;
  if (dryRun) {
    log.info({ correctionId: row.id, reason }, 'dry-run would mark correction as outlier');
    return;
  }
  updateCorrectionStatus(db, row.id, 'outlier', reason);
}

export function applyCorrections(
  db: DatabaseType,
  options: ApplyCorrectionsOptions = {},
): ApplyCorrectionsSummary {
  const dryRun = options.dryRun ?? false;
  const pending = db
    .prepare(
      `SELECT id, entity_type, entity_id, field_name, new_value
         FROM community_corrections
        WHERE status = 'pending'
        ORDER BY submitted_at ASC, id ASC`,
    )
    .all() as CorrectionRow[];

  const summary: ApplyCorrectionsSummary = {
    approved: 0,
    outliers: 0,
    rejected: 0,
    dryRun: 0,
  };

  for (const row of pending) {
    if (!allowedField(row.entity_type, row.field_name)) {
      rejectCorrection(db, row, summary, dryRun, 'auto-rejected by nightly script: invalid field for entity type');
      continue;
    }

    const target = getEntityTarget(row.entity_type);
    if (!target) {
      rejectCorrection(db, row, summary, dryRun, 'auto-rejected by nightly script: unsupported entity type');
      continue;
    }

    const currentRow = db
      .prepare(`SELECT ${row.field_name} AS value FROM ${target.tableName} WHERE id = ?`)
      .get(row.entity_id) as { value: number | string | null } | undefined;

    if (!currentRow) {
      rejectCorrection(db, row, summary, dryRun, 'auto-rejected by nightly script: target row not found');
      continue;
    }

    if (row.entity_type === 'player' && row.field_name === 'name') {
      const currentValue = String(currentRow.value ?? '');
      if (isOutlier(row.field_name, row.new_value, currentValue)) {
        flagOutlier(db, row, summary, dryRun, 'auto-flagged by nightly script: outlier correction requires manual review');
        continue;
      }

      if (dryRun) {
        summary.dryRun += 1;
        log.info(
          {
            correctionId: row.id,
            tableName: target.tableName,
            fieldName: row.field_name,
            entityId: row.entity_id,
            from: currentValue,
            to: row.new_value,
          },
          'dry-run would apply correction',
        );
        continue;
      }

      db.prepare('UPDATE players SET name = ? WHERE id = ?').run(row.new_value, row.entity_id);
      updateCorrectionStatus(db, row.id, 'approved', 'auto-approved by nightly script');
      summary.approved += 1;
      continue;
    }

    if (row.entity_type === 'player' && row.field_name === 'jersey_number') {
      const currentValue = String(currentRow.value ?? '');
      if (isOutlier(row.field_name, row.new_value, currentValue)) {
        flagOutlier(db, row, summary, dryRun, 'auto-flagged by nightly script: outlier correction requires manual review');
        continue;
      }

      const jerseyNumber = Number.parseInt(row.new_value, 10);
      if (dryRun) {
        summary.dryRun += 1;
        log.info(
          {
            correctionId: row.id,
            tableName: target.tableName,
            fieldName: row.field_name,
            entityId: row.entity_id,
            from: currentValue,
            to: jerseyNumber,
          },
          'dry-run would apply correction',
        );
        continue;
      }

      db.prepare('UPDATE players SET jersey_number = CAST(? AS INTEGER) WHERE id = ?').run(jerseyNumber, row.entity_id);
      updateCorrectionStatus(db, row.id, 'approved', 'auto-approved by nightly script');
      summary.approved += 1;
      continue;
    }

    const newValue = Number.parseInt(row.new_value, 10);
    if (Number.isNaN(newValue)) {
      rejectCorrection(db, row, summary, dryRun, 'auto-rejected by nightly script: new_value is not an integer');
      continue;
    }

    const currentValue = Number(currentRow.value ?? 0);
    if (isOutlier(row.field_name, newValue, currentValue)) {
      flagOutlier(db, row, summary, dryRun, 'auto-flagged by nightly script: outlier correction requires manual review');
      continue;
    }

    if (dryRun) {
      summary.dryRun += 1;
      log.info(
        {
          correctionId: row.id,
          tableName: target.tableName,
          fieldName: row.field_name,
          entityId: row.entity_id,
          from: currentValue,
          to: newValue,
        },
        'dry-run would apply correction',
      );
      continue;
    }

    db.prepare(`UPDATE ${target.tableName} SET ${row.field_name} = ? WHERE id = ?`).run(newValue, row.entity_id);
    updateCorrectionStatus(db, row.id, 'approved', 'auto-approved by nightly script');
    summary.approved += 1;
  }

  return summary;
}

function printSummary(summary: ApplyCorrectionsSummary): void {
  log.info(summary, 'applyCorrections complete');
}

function main(): void {
  const { dbPath, dryRun } = parseArgs(process.argv.slice(2));
  const resolvedDbPath = resolveDbPath(dbPath);
  if (!existsSync(resolvedDbPath)) {
    throw new Error(`Database not found: ${resolvedDbPath}`);
  }

  const db = openDb(resolvedDbPath);
  try {
    const summary = applyCorrections(db, { dryRun });
    printSummary(summary);
  } finally {
    db.close();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const thisPath = fileURLToPath(import.meta.url);
if (invokedPath === thisPath) {
  main();
}
