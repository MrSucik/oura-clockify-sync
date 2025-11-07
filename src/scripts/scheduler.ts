import cron from 'node-cron';
import { validateEnvironment } from '../config/env';
import { createClockifyService } from '../services/clockify-service';
import { createOuraService } from '../services/oura-service';
import { syncSleepToClockify } from '../services/sync-service';

// Validate environment on startup
const env = validateEnvironment();

/**
 * Sync sleep data from Oura to Clockify
 */
async function syncSleepToClockifyScheduler(
  ouraService: Awaited<ReturnType<typeof createOuraService>>,
  clockifyService: ReturnType<typeof createClockifyService>
): Promise<void> {
  await syncSleepToClockify(ouraService, clockifyService, env, {
    showProgressBar: false,
    logPrefix: '',
  });
}

/**
 * Run sync job
 */
async function runSyncJob() {
  const startTime = new Date();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🕐 Scheduled sync started at ${startTime.toISOString()}`);
  console.log('='.repeat(60));

  const ouraService = await createOuraService();
  const clockifyService = createClockifyService(env.CLOCKIFY_API_TOKEN);

  if (!ouraService.hasAccessToken()) {
    console.error('❌ No access token found in environment');
    console.error('   Please set OURA_ACCESS_TOKEN and OURA_REFRESH_TOKEN');
    console.error('   Run the app manually first to obtain tokens\n');
    return;
  }

  try {
    await syncSleepToClockifyScheduler(ouraService, clockifyService);

    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
    console.log(`✅ Sync completed in ${duration}s\n`);
  } catch (error) {
    console.error('❌ Sync job failed:', error);
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

// Run scheduler
main().catch((error) => {
  console.error('❌ Scheduler failed to start:', error);
  process.exit(1);
});
