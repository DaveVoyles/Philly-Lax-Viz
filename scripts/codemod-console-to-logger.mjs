// One-shot codemod: add a `createLogger` import + `log` const to each
// target file, then mechanically replace `console.{log,warn,error}(`
// with `log.{info,warn,error}(`. Pino's util.format-style interpolation
// makes positional-arg console calls drop in cleanly.
//
// Excluded files:
//   - mineAliases.ts and seedAliasesFromMine.ts (just shipped in Wave 4)
//   - Anything outside packages/ingest/src/

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FILES = process.argv.slice(2);
const EXCLUDE = new Set(['mineAliases.ts', 'seedAliasesFromMine.ts']);

let totalReplaced = 0;
let totalFiles = 0;

for (const file of FILES) {
  const base = path.basename(file);
  if (EXCLUDE.has(base)) continue;

  const original = readFileSync(file, 'utf8');
  let src = original;

  let replaced = 0;
  src = src.replace(/console\.log\(/g, () => { replaced++; return 'log.info('; });
  src = src.replace(/console\.warn\(/g, () => { replaced++; return 'log.warn('; });
  src = src.replace(/console\.error\(/g, () => { replaced++; return 'log.error('; });

  if (replaced === 0) continue;

  const name = base.replace(/\.ts$/, '');
  const loggerInit =
    `import { createLogger } from '@pll/shared';\n` +
    `const log = createLogger({ name: 'ingest:${name}' });\n`;

  // Insert after the last top-level import.
  const importRe = /^import [^\n]*;\s*$/gm;
  let lastImportEnd = -1;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    lastImportEnd = m.index + m[0].length;
  }

  if (lastImportEnd === -1) {
    const lines = src.split('\n');
    let insertAt = 0;
    if (lines[0]?.startsWith('#!')) insertAt = 1;
    while (lines[insertAt]?.startsWith('//')) insertAt++;
    if (lines[insertAt]?.startsWith('/*')) {
      while (insertAt < lines.length && !lines[insertAt]?.includes('*/')) insertAt++;
      insertAt++;
    }
    lines.splice(insertAt, 0, '', loggerInit.trimEnd());
    src = lines.join('\n');
  } else {
    src =
      src.slice(0, lastImportEnd) +
      '\n' +
      loggerInit.trimEnd() +
      src.slice(lastImportEnd);
  }

  writeFileSync(file, src);
  totalReplaced += replaced;
  totalFiles++;
  process.stdout.write(`  ${file}: ${replaced} call(s) replaced\n`);
}

process.stdout.write(`\nDone: ${totalReplaced} call(s) across ${totalFiles} file(s)\n`);
