import { Queue } from 'bullmq';
import { getRedisConnection } from '../config/redis';

export const SYNC_QUEUE_NAME = 'oura-clockify-sync';

export type SyncJobData = {
  triggeredBy: 'schedule' | 'manual';
  timestamp: string;
};

let syncQueue: Queue<SyncJobData> | null = null;

export function getSyncQueue(): Queue<SyncJobData> {
  if (!syncQueue) {
    const connection = getRedisConnection();
    syncQueue = new Queue<SyncJobData>(SYNC_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 1, // No retries - wait for next scheduled run
        removeOnComplete: {
          count: 100, // Keep last 100 completed jobs
          age: 24 * 3600, // Remove after 24 hours
        },
        removeOnFail: {
          count: 50, // Keep last 50 failed jobs
          age: 7 * 24 * 3600, // Remove after 7 days
        },
      },
    });
  }

  return syncQueue;
}

export async function closeSyncQueue(): Promise<void> {
  if (syncQueue) {
    await syncQueue.close();
    syncQueue = null;
  }
}
