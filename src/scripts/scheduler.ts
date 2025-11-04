import cron from 'node-cron';
import { validateEnvironment } from '../config/env';
import { createClockifyService } from '../services/clockify-service';
import { createOuraService } from '../services/oura-service';
import {
  createSessionId,
  formatDuration,
  getErrorMessage,
  isApiError,
  sleep,
} from '../utils/common';

// Validate environment on startup
const env = validateEnvironment();

/**
 * Sync sleep data from Oura to Clockify
 */
async function syncSleepToClockify(
  ouraService: ReturnType<typeof createOuraService>,
  clockifyService: ReturnType<typeof createClockifyService>
): Promise<void> {
  try {
    console.log('🔄 Starting Oura to Clockify sync...\n');

    // Initialize Clockify client
    await clockifyService.initialize();

    // Get ALL historical sleep data
    const today = new Date();
    const endDate = today.toISOString().split('T')[0];
    const startDate = '2015-01-01';

    console.log(`📅 Fetching sleep data from ${startDate} to ${endDate}...\n`);

    const sleepData = await ouraService.getSleepData(startDate, endDate);
    console.log(`✅ Found ${sleepData.data.length} sleep sessions in Oura\n`);

    const existingEntries = await clockifyService.getTimeEntriesForDateRange(
      startDate,
      endDate
    );
    console.log(`📊 Found ${existingEntries.length} existing time entries in Clockify`);

    const existingSleepEntries = existingEntries.filter((entry) =>
      entry.description.includes('🛌 Sleep')
    );
    console.log(`   - ${existingSleepEntries.length} are sleep entries\n`);

    // Sync each sleep session
    let syncedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const sleepSession of sleepData.data) {
      const sessionId = createSessionId(sleepSession.bedtime_start, sleepSession.day);

      if (await clockifyService.isSessionSynced(sessionId, existingEntries)) {
        skippedCount++;
        continue;
      }

      const totalMinutes = Math.round(sleepSession.total_sleep_duration / 60);
      const { hours: durationHours, minutes: durationMinutes } = formatDuration(totalMinutes);
      const description = `🛌 Sleep - ${durationHours}h ${durationMinutes}m (${sleepSession.efficiency}% efficiency) [Oura:${sessionId}]`;

      try {
        await clockifyService.createTimeEntry({
          start: sleepSession.bedtime_start,
          end: sleepSession.bedtime_end,
          billable: false,
          description: description,
        });

        syncedCount++;
        await sleep(env.CLOCKIFY_API_DELAY);
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        failedCount++;

        if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
          await sleep(200);
        }
      }
    }

    console.log(`\n✅ Sync complete at ${new Date().toISOString()}`);
    console.log(`   - Newly synced: ${syncedCount}`);
    console.log(`   - Already existed: ${skippedCount}`);
    console.log(`   - Failed: ${failedCount}\n`);
  } catch (error: unknown) {
    console.error('\n❌ Sync failed:');

    if (isApiError(error)) {
      console.error('Status:', error.status);
      const errorData = error.data as Record<string, unknown>;
      console.error('Error:', errorData?.detail || error.statusText);
    } else {
      console.error('Error:', getErrorMessage(error));
    }
    throw error;
  }
}

/**
 * Run sync job
 */
async function runSyncJob() {
  const startTime = new Date();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🕐 Scheduled sync started at ${startTime.toISOString()}`);
  console.log('='.repeat(60));

  const ouraService = createOuraService();
  const clockifyService = createClockifyService(env.CLOCKIFY_API_TOKEN);

  // Check if we have access token
  if (!ouraService.hasAccessToken()) {
    console.error('❌ No access token found in environment');
    console.error('   Please set OURA_ACCESS_TOKEN and OURA_REFRESH_TOKEN');
    console.error('   Run the app manually first to obtain tokens\n');
    return;
  }

  try {
    await syncSleepToClockify(ouraService, clockifyService);

    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
    console.log(`✅ Sync completed in ${duration}s\n`);
  } catch (error) {
    console.error('❌ Sync job failed:', getErrorMessage(error));
    console.error('   Will retry on next scheduled run\n');
  }
}

// Main execution
async function main() {
  console.log('🛌 Oura Clockify Sync - Scheduler\n');
  console.log('This service will automatically sync your Oura sleep data to Clockify.\n');

  // Get schedule from environment or default to hourly
  const schedule = process.env.SYNC_SCHEDULE || '0 * * * *'; // Default: Every hour at minute 0

  console.log(`📅 Schedule: ${schedule}`);
  console.log(`   (Cron format: ${getCronDescription(schedule)})\n`);

  // Validate cron expression
  if (!cron.validate(schedule)) {
    console.error('❌ Invalid cron schedule:', schedule);
    console.error('   Using default: 0 * * * * (hourly)');
    process.exit(1);
  }

  // Run once immediately on startup
  console.log('🚀 Running initial sync...');
  await runSyncJob();

  // Schedule recurring syncs
  console.log(`⏰ Scheduler started. Next sync at top of the hour.`);
  console.log('   Press Ctrl+C to stop.\n');

  cron.schedule(schedule, async () => {
    await runSyncJob();
  });

  // Keep process alive
  process.on('SIGTERM', () => {
    console.log('\n👋 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('\n👋 Received SIGINT, shutting down gracefully...');
    process.exit(0);
  });
}

/**
 * Get human-readable description of cron schedule
 */
function getCronDescription(schedule: string): string {
  const presets: Record<string, string> = {
    '* * * * *': 'Every minute',
    '0 * * * *': 'Every hour',
    '0 */6 * * *': 'Every 6 hours',
    '0 0 * * *': 'Daily at midnight',
    '0 6 * * *': 'Daily at 6 AM',
  };

  return presets[schedule] || schedule;
}

// Run the scheduler
main().catch((error) => {
  console.error('❌ Scheduler failed to start:', error);
  process.exit(1);
});
