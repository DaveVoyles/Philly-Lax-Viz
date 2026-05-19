import { getFreshness } from '../../api.js';

export async function loadDashboardFreshness(target: HTMLElement): Promise<void> {
  try {
    const data = await getFreshness();
    if (!data.lastIngestAt) {
      target.textContent = 'Data freshness: unknown';
      return;
    }
    const t = Date.parse(data.lastIngestAt);
    if (Number.isNaN(t)) {
      target.textContent = 'Data freshness: unknown';
      return;
    }
    const ms = Date.now() - t;
    const min = Math.round(ms / 60_000);
    const rel =
      min < 60
        ? `${min} minutes`
        : min < 24 * 60
          ? `${Math.round(min / 60)} hours`
          : `${Math.round(min / 60 / 24)} days`;
    target.textContent = `Data updated ${rel} ago.`;
  } catch {
    target.textContent = '';
  }
}
