import { validateEnvironment } from '../config/env';
import type { createClockifyService } from '../services/clockify-service';
import type { createOuraService } from '../services/oura-service';
import { syncSleepToClockify } from '../services/sync-service';

const env = validateEnvironment();

/**
 * Sync sleep data from Oura to Clockify
 */
export async function syncSleepToClockifyExport(
  ouraService: Awaited<ReturnType<typeof createOuraService>>,
  clockifyService: ReturnType<typeof createClockifyService>
): Promise<void> {
  await syncSleepToClockify(ouraService, clockifyService, env, { showProgressBar: true });
}
