import { validateEnvironment } from '../config/env';
import { closeRedisConnection } from '../config/redis';
import { closeSyncQueue, getSyncQueue } from '../queues/sync-queue';
import { closeSyncWorker, createSyncWorker } from '../workers/sync-worker';

// Validate environment on startup
validateEnvironment();

/**
 * Worker-only mode runner
 * This script runs only the BullMQ worker without the HTTP server
 */
async function main() {
  console.log('🛌 Oura Clockify Sync - Worker\n');
  console.log('This worker will process sync jobs from the BullMQ queue.\n');

  // Get schedule from environment or default to hourly
  const schedule = process.env.SYNC_SCHEDULE || '0 * * * *';
  console.log(`📅 Schedule: ${schedule}`);
  console.log(`   (${getCronDescription(schedule)})\n`);

  // Initialize queue and worker
  const syncQueue = getSyncQueue();
  const _syncWorker = createSyncWorker();

  // Setup scheduled job
  console.log('📅 Setting up scheduled sync job...');

  // Remove stale repeatable schedules before adding new one
  const repeatableJobs = await syncQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    console.log(`🧹 Removing existing repeatable job: ${job.key}`);
    await syncQueue.removeRepeatableByKey(job.key);
  }

  await syncQueue.add(
    'sync',
    {
      triggeredBy: 'schedule',
      timestamp: new Date().toISOString(),
    },
    {
      repeat: {
        pattern: schedule,
      },
    }
  );

  // Run initial sync immediately
  console.log('🚀 Running initial sync...');
  await syncQueue.add('sync', {
    triggeredBy: 'schedule',
    timestamp: new Date().toISOString(),
  });

  console.log('\n✅ Worker started. Waiting for jobs...');
  console.log('   Press Ctrl+C to stop.\n');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n👋 Shutting down gracefully...');

    await closeSyncWorker();
    await closeSyncQueue();
    await closeRedisConnection();

    console.log('✅ Cleanup complete');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
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

// Run worker
main().catch((error) => {
  console.error('❌ Worker failed to start:', error);
  process.exit(1);
});
