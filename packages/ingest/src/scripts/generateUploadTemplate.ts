import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { createLogger } from '@pll/shared';

const log = createLogger({ name: 'ingest:generateUploadTemplate' });

const HEADERS = [
  'Player Name',
  'Game Date',
  'Opponent',
  'Goals',
  'Assists',
  'Ground Balls',
  'Caused Turnovers',
  'Saves',
  'FO Won',
  'FO Taken',
];

const EXAMPLE_ROWS = [
  ['John Smith', '2026-03-15', 'Lower Merion', 3, 2, 5, 1, 0, 0, 0],
  ['Jane Doe', '2026-03-15', 'Lower Merion', 0, 0, 2, 0, 12, 0, 0],
  ['Alex Johnson', '2026-03-22', 'Conestoga', 1, 4, 3, 2, 0, 6, 9],
];

function resolveOutputPath(): string {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, '../../../../');
  return resolve(repoRoot, 'packages/web/public/data/upload-template.xlsx');
}

function main(): void {
  const outputPath = resolveOutputPath();
  mkdirSync(dirname(outputPath), { recursive: true });

  const worksheet = XLSX.utils.aoa_to_sheet([HEADERS, ...EXAMPLE_ROWS]);
  worksheet['!cols'] = [
    { wch: 24 },
    { wch: 14 },
    { wch: 22 },
    { wch: 10 },
    { wch: 10 },
    { wch: 14 },
    { wch: 18 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Stats');
  XLSX.writeFile(workbook, outputPath);

  log.info({ outputPath }, 'Generated upload template workbook');
}

main();
