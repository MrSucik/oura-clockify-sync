import * as cliProgress from 'cli-progress';
import {
  createSessionId,
  createSleepDescription,
  getErrorMessage,
  handleRateLimitError,
  isApiError,
  sleep,
} from '../utils/common';
import type { createClockifyService } from './clockify-service';
import type { createOuraService } from './oura-service';

export interface SyncOptions {
  showProgressBar?: boolean;
  logPrefix?: string;
}

export interface SyncResult {
  syncedCount: number;
  skippedCount: number;
  failedCount: number;
  totalSessions: number;
  existingSleepEntries: number;
}

/**
 * Sync sleep data from Oura to Clockify
 */
export async function syncSleepToClockify(
  ouraService: Awaited<ReturnType<typeof createOuraService>>,
  clockifyService: ReturnType<typeof createClockifyService>,
  env: { CLOCKIFY_API_DELAY: number },
  options: SyncOptions = {}
): Promise<SyncResult> {
  const { showProgressBar = false, logPrefix = '' } = options;

  try {
    console.log(`${logPrefix}🔄 Starting Oura to Clockify sync...\n`);

    // Initialize Clockify client
    await clockifyService.initialize();

    // Get ALL historical sleep data
    const today = new Date();
    const endDate = today.toISOString().split('T')[0];
    // Oura started in 2013, but let's go back to 2015 to be safe
    const startDate = '2015-01-01';

    console.log(
      `${logPrefix}📅 Fetching ALL historical sleep data from ${startDate} to ${endDate}...\n`
    );

    const sleepData = await ouraService.getSleepData(startDate, endDate);
    console.log(`${logPrefix}✅ Found ${sleepData.data.length} sleep sessions in Oura\n`);

    // Get existing Clockify entries for the date range
    const existingEntries = await clockifyService.getTimeEntriesForDateRange(startDate, endDate);
    console.log(`${logPrefix}📊 Found ${existingEntries.length} existing time entries in Clockify`);

    // Show existing sleep entries for debugging
    const existingSleepEntries = existingEntries.filter((entry) =>
      entry.description.includes('🛌 Sleep')
    );
    console.log(`${logPrefix}   - ${existingSleepEntries.length} are sleep entries`);
    if (existingSleepEntries.length > 0) {
      console.log(`${logPrefix}   - Sample: ${existingSleepEntries[0].description}`);
    }
    console.log('');

    // Sync each sleep session
    let syncedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    console.log(`${logPrefix}📊 Processing sleep sessions...\n`);

    let progressBar: cliProgress.SingleBar | null = null;

    if (showProgressBar) {
      progressBar = new cliProgress.SingleBar({
        format: '⏳ Progress |{bar}| {percentage}% | {value}/{total} Sessions | {day}',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
      });

      progressBar.start(sleepData.data.length, 0, {
        day: 'Starting...',
      });
    }

    for (let i = 0; i < sleepData.data.length; i++) {
      const sleepSession = sleepData.data[i];

      // Create unique session ID
      const sessionId = createSessionId(sleepSession.bedtime_start, sleepSession.day);

      // Update progress bar
      if (progressBar) {
        progressBar.update(i + 1, {
          day: sleepSession.day,
        });
      }

      // Check if already synced
      if (await clockifyService.isSessionSynced(sessionId, existingEntries)) {
        skippedCount++;
        continue;
      }

      // Create time entry for sleep session
      const totalMinutes = Math.round(sleepSession.total_sleep_duration / 60);
      const description = createSleepDescription(totalMinutes, sleepSession.efficiency, sessionId);

      try {
        await clockifyService.createTimeEntry({
          start: sleepSession.bedtime_start,
          end: sleepSession.bedtime_end,
          billable: false,
          description: description,
        });

        syncedCount++;

        // Add delay after successful API call to avoid rate limiting
        await sleep(env.CLOCKIFY_API_DELAY);
      } catch (error: unknown) {
        failedCount++;

        // If we hit rate limit, wait longer before continuing
        await handleRateLimitError(error);
      }
    }

    // Stop progress bar
    if (progressBar) {
      progressBar.stop();
    }

    console.log(`${logPrefix}\n🎉 Sync complete!`);
    console.log(`${logPrefix}   - Oura sleep sessions: ${sleepData.data.length}`);
    console.log(`${logPrefix}   - Newly synced: ${syncedCount}`);
    console.log(`${logPrefix}   - Already existed: ${skippedCount}`);
    console.log(`${logPrefix}   - Failed: ${failedCount}`);
    console.log(
      `${logPrefix}   - Total in Clockify now: ${existingSleepEntries.length + syncedCount} sleep entries`
    );

    return {
      syncedCount,
      skippedCount,
      failedCount,
      totalSessions: sleepData.data.length,
      existingSleepEntries: existingSleepEntries.length,
    };
  } catch (error: unknown) {
    console.error(`${logPrefix}\n❌ Sync failed:`);

    if (isApiError(error)) {
      console.error(`${logPrefix}Status:`, error.status);
      const errorData = error.data as Record<string, unknown>;
      console.error(`${logPrefix}Error:`, errorData?.detail || error.statusText);
    } else {
      console.error(`${logPrefix}Error:`, getErrorMessage(error));
    }
    throw error;
  }
}
