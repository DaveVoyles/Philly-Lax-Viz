// API base URL helper.
//
// In dev the Vite proxy rewrites `/api/*` → `http://localhost:3001/api/*`,
// so the empty default keeps relative paths working unchanged.
// In production builds, set VITE_API_BASE_URL to the absolute origin of the
// backend (e.g. `https://pll-server.proudwave-03a07ae1.eastus.azurecontainerapps.io`)
// and every /api call is rewritten to hit that origin.

const RAW_BASE = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  ?.VITE_API_BASE_URL ?? '';

export const API_BASE: string = RAW_BASE.replace(/\/+$/, '');

/** Prefix `path` (which already starts with `/api/...` or `/...`) with the configured API base. */
export function apiUrl(path: string): string {
  if (!API_BASE) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
}
