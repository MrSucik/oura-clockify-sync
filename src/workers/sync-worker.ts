import { type Job, Worker } from 'bullmq';
import { validateEnvironment } from '../config/env';
import { getRedisConnection } from '../config/redis';
import { SYNC_QUEUE_NAME, type SyncJobData } from '../queues/sync-queue';
import { createClockifyService } from '../services/clockify-service';
import { createOuraService } from '../services/oura-service';
import { syncSleepToClockify } from '../services/sync-service';

const env = validateEnvironment();

async function processSyncJob(job: Job<SyncJobData>): Promise<void> {
  const startTime = new Date();
  const { triggeredBy } = job.data;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🕐 Sync job started at ${startTime.toISOString()}`);
  console.log(`📋 Job ID: ${job.id}`);
  console.log(`🎯 Triggered by: ${triggeredBy}`);
  console.log('='.repeat(60));

  const ouraService = await createOuraService();
  const clockifyService = createClockifyService(env.CLOCKIFY_API_TOKEN);

  if (!ouraService.hasAccessToken()) {
    console.error('❌ No access token found in environment');
    console.error('   Please set OURA_ACCESS_TOKEN and OURA_REFRESH_TOKEN');
    console.error('   Run the app manually first to obtain tokens\n');
    throw new Error('No Oura access token available');
  }

  await syncSleepToClockify(ouraService, clockifyService, env, {
    showProgressBar: false,
    logPrefix: '',
  });

  const endTime = new Date();
  const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
  console.log(`✅ Sync completed in ${duration}s\n`);
}

let worker: Worker<SyncJobData> | null = null;

export function createSyncWorker(): Worker<SyncJobData> {
  if (worker) {
    return worker;
  }

  const connection = getRedisConnection();

  worker = new Worker<SyncJobData>(
    SYNC_QUEUE_NAME,
    async (job: Job<SyncJobData>) => {
      await processSyncJob(job);
    },
    {
      connection,
      concurrency: 1, // Process one job at a time
    }
  );

  worker.on('completed', (job: Job<SyncJobData>) => {
    console.log(`✅ Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job: Job<SyncJobData> | undefined, error: Error) => {
    console.error(`❌ Job ${job?.id} failed:`, error);
    console.error('   Will retry on next scheduled run\n');
  });

  worker.on('error', (error: Error) => {
    console.error('❌ Worker error:', error);
  });

  console.log('👷 Sync worker started');

  return worker;
}

export async function closeSyncWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}
