// Logo binary downloader — used by syncLogos. Extracted so we can unit-test
// the idempotent skip behavior without invoking the script's top-level main().

import fs from 'node:fs';
import path from 'node:path';

export interface DownloadOutcome {
  written: boolean;
  bytes: number;
  filename: string;
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Download a logo to `destPath`. If a file already exists at that path and a
 * HEAD request to `url` reports the same Content-Length, skip the GET. If the
 * HEAD request fails for any reason but the local file exists, also skip
 * (offline-friendly). Otherwise GET and write the bytes.
 */
export async function downloadLogo(url: string, destPath: string): Promise<DownloadOutcome> {
  const filename = path.basename(destPath);
  if (fs.existsSync(destPath)) {
    const local = fs.statSync(destPath).size;
    try {
      const head = await fetch(url, { method: 'HEAD' });
      const remoteLen = Number(head.headers.get('content-length') ?? '0');
      if (head.ok && remoteLen > 0 && remoteLen === local) {
        return { written: false, bytes: local, filename };
      }
    } catch {
      return { written: false, bytes: local, filename };
    }
  }

  const res = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'image/gif,image/webp,image/*;q=0.8',
    },
  });
  if (!res.ok) {
    throw new Error(`logo fetch failed ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return { written: true, bytes: buf.length, filename };
}
