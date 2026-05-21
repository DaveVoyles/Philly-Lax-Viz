// pblaScheduler.ts — Weekday-only scheduled PBLA scraper.
// Runs inside the Fastify server process on Azure Container Apps.
// Schedule: Mon-Fri at 11:00 PM ET (after games typically end at 9:30 PM).
// No external dependencies — uses setInterval with day-of-week guard.

import { createLogger } from '@pll/shared';

const log = createLogger({ name: 'server:pbla-scheduler' });

interface SchedulerOptions {
  /** DB path for the sync script */
  dbPath: string;
  /** League ID to scrape (defaults to current season) */
  leagueId?: number;
  /** Optional cookies for authenticated access */
  cookies?: string;
  /** Check interval in ms (default: 60000 = 1 minute) */
  checkIntervalMs?: number;
  /** Target hour in ET (0-23, default: 23 = 11 PM) */
  targetHourET?: number;
  /** Target minute (default: 0) */
  targetMinuteET?: number;
}

// Default league IDs per season
const LEAGUE_IDS: Record<number, number> = {
  2025: 50247,
  2026: 50731,
};

function getCurrentLeagueId(): number {
  const year = new Date().getFullYear();
  return LEAGUE_IDS[year] ?? LEAGUE_IDS[2026] ?? 50731;
}

/**
 * Get the current hour in US Eastern Time.
 * Handles both EST (UTC-5) and EDT (UTC-4) automatically.
 */
function getEasternTime(): { hour: number; minute: number; dayOfWeek: number } {
  const now = new Date();
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return {
    hour: eastern.getHours(),
    minute: eastern.getMinutes(),
    dayOfWeek: eastern.getDay(), // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  };
}

function isWeekday(dayOfWeek: number): boolean {
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

/**
 * Start the PBLA scrape scheduler. Checks every minute if it's time to run.
 * Only runs Mon-Fri at the target time (11 PM ET by default).
 * Returns a cleanup function to stop the scheduler.
 */
export function startPblaScheduler(opts: SchedulerOptions): () => void {
  const checkInterval = opts.checkIntervalMs ?? 60_000;
  const targetHour = opts.targetHourET ?? 23;
  const targetMinute = opts.targetMinuteET ?? 0;
  const leagueId = opts.leagueId ?? getCurrentLeagueId();

  let lastRunDate = ''; // Track the last date we ran to avoid double-runs
  let running = false;

  log.info(
    `[pbla-scheduler] started: Mon-Fri at ${targetHour}:${String(targetMinute).padStart(2, '0')} ET, ` +
      `league=${leagueId}, check every ${checkInterval / 1000}s`,
  );

  const interval = setInterval(async () => {
    if (running) return;

    const { hour, minute, dayOfWeek } = getEasternTime();

    // Only run on weekdays
    if (!isWeekday(dayOfWeek)) return;

    // Check if we're in the target time window (within the check interval)
    if (hour !== targetHour || minute !== targetMinute) return;

    // Prevent double-run on the same day
    const today = new Date().toISOString().slice(0, 10);
    if (lastRunDate === today) return;

    running = true;
    lastRunDate = today;
    log.info(`[pbla-scheduler] triggering scrape for league ${leagueId}`);

    try {
      // Dynamic import to avoid circular dependency issues at startup
      const { syncPbla } = await import('@pll/ingest/src/scripts/syncPbla.js');
      await syncPbla({
        leagueId,
        dryRun: false,
        cookies: opts.cookies ?? process.env.SPORTABILITY_COOKIES,
        dbPath: opts.dbPath,
      });
      log.info('[pbla-scheduler] scrape completed successfully');
    } catch (err) {
      log.error(`[pbla-scheduler] scrape failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  }, checkInterval);

  // Return cleanup function
  return () => {
    clearInterval(interval);
    log.info('[pbla-scheduler] stopped');
  };
}
