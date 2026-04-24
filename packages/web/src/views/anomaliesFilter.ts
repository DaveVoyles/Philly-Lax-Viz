// Wave H8 Lane 3 (Leia) — pure helpers for the /anomalies strategy filter.
// Kept dependency-free + DOM-free so they can be unit-tested in node.

import type { IngestAnomaly } from '@pll/shared';

export type Anomaly = IngestAnomaly;

export function groupByStrategy(rows: Anomaly[]): Map<string, Anomaly[]> {
  const out = new Map<string, Anomaly[]>();
  for (const r of rows) {
    const key = r.strategyAttempted;
    let bucket = out.get(key);
    if (!bucket) {
      bucket = [];
      out.set(key, bucket);
    }
    bucket.push(r);
  }
  return out;
}

export function parseStrategyParam(hash: string): string | null {
  if (!hash) return null;
  const qIdx = hash.indexOf('?');
  if (qIdx < 0) return null;
  const qs = hash.slice(qIdx + 1);
  if (!qs) return null;
  for (const part of qs.split('&')) {
    const eq = part.indexOf('=');
    const key = eq >= 0 ? part.slice(0, eq) : part;
    if (key !== 'strategy') continue;
    const raw = eq >= 0 ? part.slice(eq + 1) : '';
    if (!raw) return null;
    try {
      const decoded = decodeURIComponent(raw.replace(/\+/g, ' '));
      return decoded === '' ? null : decoded;
    } catch {
      return null;
    }
  }
  return null;
}

export function buildStrategyHash(strategy: string | null): string {
  if (strategy === null || strategy === '') return '#/anomalies';
  return `#/anomalies?strategy=${encodeURIComponent(strategy)}`;
}
