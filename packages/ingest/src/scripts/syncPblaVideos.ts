/**
 * syncPblaVideos.ts
 *
 * Fetches the PBLA YouTube channel RSS feed, extracts 2026 season
 * stream video IDs, and updates packages/web/src/views/pblaData.ts
 * with any new entries in PBLA_VIDEOS.
 *
 * Usage:
 *   pnpm --filter @pll/ingest exec tsx src/scripts/syncPblaVideos.ts
 *   pnpm --filter @pll/ingest exec tsx src/scripts/syncPblaVideos.ts --dry-run
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHANNEL_ID = 'UC8dQQ4Z-MjxCCBu380ViuEg';
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const TARGET_YEAR = '2026';
const PBLA_DATA_PATH = resolve(
  import.meta.dirname,
  '../../../../packages/web/src/views/pblaData.ts',
);

interface VideoEntry {
  date: string;
  videoId: string;
  title: string;
}

async function fetchFeed(): Promise<string> {
  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);
  return res.text();
}

function parseEntries(xml: string): VideoEntry[] {
  const entries: VideoEntry[] = [];
  // Simple regex parsing - YouTube RSS is well-structured
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const videoId = block.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1];
    const published = block.match(/<published>(.*?)<\/published>/)?.[1];
    const title = block.match(/<title>(.*?)<\/title>/)?.[1];

    if (!videoId || !published || !title) continue;

    const date = published.slice(0, 10); // YYYY-MM-DD
    if (!date.startsWith(TARGET_YEAR)) continue;

    // Only include PBLA streams (filter out non-game content)
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes('pbla') || lowerTitle.includes('lacrosse') || lowerTitle.includes('live')) {
      entries.push({ date, videoId, title });
    }
  }

  return entries;
}

function readCurrentVideos(): Record<string, string> {
  const src = readFileSync(PBLA_DATA_PATH, 'utf-8');
  const blockMatch = src.match(
    /export const PBLA_VIDEOS: Record<string, string> = \{([\s\S]*?)\};/,
  );
  if (!blockMatch) throw new Error('Could not find PBLA_VIDEOS in pblaData.ts');

  const videos: Record<string, string> = {};
  const lineRegex = /'(\d{4}-\d{2}-\d{2})':\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(blockMatch[1])) !== null) {
    videos[m[1]] = m[2];
  }
  return videos;
}

function writeUpdatedVideos(videos: Record<string, string>): void {
  const src = readFileSync(PBLA_DATA_PATH, 'utf-8');

  const sorted = Object.entries(videos).sort(([a], [b]) => a.localeCompare(b));
  const entries = sorted.map(([date, id]) => `  '${date}': '${id}',`).join('\n');

  const newBlock = `export const PBLA_VIDEOS: Record<string, string> = {\n  // ${TARGET_YEAR} season - auto-synced from @PBLA_Official YouTube\n${entries}\n};`;

  const updated = src.replace(
    /export const PBLA_VIDEOS: Record<string, string> = \{[\s\S]*?\};/,
    newBlock,
  );

  writeFileSync(PBLA_DATA_PATH, updated, 'utf-8');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`Fetching PBLA YouTube feed (channel: ${CHANNEL_ID})...`);
  const xml = await fetchFeed();

  const feedEntries = parseEntries(xml);
  console.log(`Found ${feedEntries.length} ${TARGET_YEAR} streams in feed`);

  const current = readCurrentVideos();
  console.log(`Current PBLA_VIDEOS has ${Object.keys(current).length} entries`);

  let added = 0;
  for (const entry of feedEntries) {
    if (!current[entry.date]) {
      current[entry.date] = entry.videoId;
      added++;
      console.log(`  + ${entry.date} -> ${entry.videoId} (${entry.title})`);
    }
  }

  if (added === 0) {
    console.log('No new videos to add. Already up to date.');
    return;
  }

  if (dryRun) {
    console.log(`\n[DRY RUN] Would add ${added} new video(s). No files changed.`);
    return;
  }

  writeUpdatedVideos(current);
  console.log(`\nUpdated pblaData.ts with ${added} new video(s).`);
  console.log('Total entries:', Object.keys(current).length);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
