import { validateEnvironment } from '../config/env';
import { createClockifyService } from '../services/ClockifyService';
import { createOuraService } from '../services/OuraService';
import { createSessionId, formatDuration, getErrorMessage, sleep } from '../utils/common';
import { getValidToken } from '../utils/token';

// Validate environment on startup
const env = validateEnvironment();

async function syncSleepData(): Promise<void> {
  try {
    console.log('🛌 Oura Sleep Tracker → Clockify Auto Sync\n');
    console.log('⏰ Running automatic sync at:', new Date().toISOString());

    // Get valid access token (will refresh if needed)
    const accessToken = await getValidToken();
    console.log('✅ Valid access token obtained\n');

    // Initialize services
    const ouraService = createOuraService();
    const clockifyService = createClockifyService(env.CLOCKIFY_API_TOKEN);

    // Initialize Clockify client
    await clockifyService.initialize();

    // Get recent sleep data (from environment configuration or override)
    const syncDays = process.env.SYNC_DAYS ? parseInt(process.env.SYNC_DAYS, 10) : env.SYNC_DAYS;
    const today = new Date();
    const endDate = today.toISOString().split('T')[0];
    const startDateObj = new Date(today);
    startDateObj.setDate(startDateObj.getDate() - syncDays);
    const startDate = startDateObj.toISOString().split('T')[0];

    console.log(
      `📅 Fetching sleep data from ${startDate} to ${endDate} (last ${syncDays} day${syncDays > 1 ? 's' : ''})...\n`
    );

    const sleepData = await ouraService.getSleepData(startDate, endDate, accessToken);
    console.log(`✅ Found ${sleepData.data.length} sleep sessions in Oura\n`);

    // Get existing Clockify entries
    const existingEntries = await clockifyService.getTimeEntriesForDateRange(startDate, endDate);
    const existingSleepEntries = existingEntries.filter((entry) =>
      entry.description.includes('🛌 Sleep')
    );
    console.log(`📊 Found ${existingSleepEntries.length} existing sleep entries in Clockify\n`);

    // Sync each sleep session
    let syncedCount = 0;
    let skippedCount = 0;

    for (const sleepSession of sleepData.data) {
      const sessionId = createSessionId(sleepSession.bedtime_start, sleepSession.day);

      const totalMinutes = Math.round(sleepSession.total_sleep_duration / 60);
      const { hours: durationHours, minutes: durationMinutes } = formatDuration(totalMinutes);

      console.log(
        `🔍 Processing: ${sleepSession.day} | Duration: ${durationHours}h ${durationMinutes}m`
      );

      if (await clockifyService.isSessionSynced(sessionId, existingEntries)) {
        console.log(`⏭️  Skipping already synced session`);
        skippedCount++;
        continue;
      }

      const description = `🛌 Sleep - ${durationHours}h ${durationMinutes}m (${sleepSession.efficiency}% efficiency) [Oura:${sessionId}]`;

      try {
        await clockifyService.createTimeEntry({
          start: sleepSession.bedtime_start,
          end: sleepSession.bedtime_end,
          billable: false,
          description: description,
        });

        console.log(`✅ Synced sleep session`);
        syncedCount++;

        await sleep(env.CLOCKIFY_API_DELAY);
      } catch (error: unknown) {
        console.error(`❌ Failed to sync session:`, getErrorMessage(error));
      }
    }

    console.log(`\n🎉 Sync complete!`);
    console.log(`   - Newly synced: ${syncedCount}`);
    console.log(`   - Already existed: ${skippedCount}`);
    console.log(`   - Next run will check for new sleep data\n`);
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    console.error('\n❌ Auto sync failed:', errorMessage);

    if (errorMessage.includes('No tokens found')) {
      console.error('\n⚠️  Initial authentication required!');
      console.error('Run "npm start" to authenticate first, then you can use auto-sync.');
    } else if (errorMessage.includes('Failed to refresh token')) {
      console.error('\n⚠️  Token refresh failed! You may need to re-authenticate.');
      console.error('Run "npm start" to get new tokens.');
    }

    process.exit(1);
  }
}

// Run the sync
syncSleepData().catch(console.error);
