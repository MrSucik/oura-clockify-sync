import * as crypto from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
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
import { saveTokens } from '../utils/token';

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
    // Oura started in 2013, but let's go back to 2015 to be safe
    const startDate = '2015-01-01';

    console.log(`📅 Fetching ALL historical sleep data from ${startDate} to ${endDate}...\n`);

    const sleepData = await ouraService.getSleepData(startDate, endDate);
    console.log(`✅ Found ${sleepData.data.length} sleep sessions in Oura\n`);

    // Get existing Clockify entries for the date range
    const existingEntries = await clockifyService.getTimeEntriesForDateRange(
      startDate,
      endDate
    );
    console.log(`📊 Found ${existingEntries.length} existing time entries in Clockify`);

    // Show existing sleep entries for debugging
    const existingSleepEntries = existingEntries.filter((entry) =>
      entry.description.includes('🛌 Sleep')
    );
    console.log(`   - ${existingSleepEntries.length} are sleep entries`);
    if (existingSleepEntries.length > 0) {
      console.log(`   - Sample: ${existingSleepEntries[0].description}`);
    }
    console.log('');

    // Sync each sleep session
    let syncedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const sleepSession of sleepData.data) {
      // Create unique session ID
      const sessionId = createSessionId(sleepSession.bedtime_start, sleepSession.day);

      const totalMinutes = Math.round(sleepSession.total_sleep_duration / 60);
      const { hours: durationHours, minutes: durationMinutes } = formatDuration(totalMinutes);

      console.log(
        `\n🔍 Processing: ${sleepSession.day} | Duration: ${durationHours}h ${durationMinutes}m`
      );
      console.log(`   Session ID: [Oura:${sessionId}]`);

      // Check if already synced
      if (await clockifyService.isSessionSynced(sessionId, existingEntries)) {
        console.log(`⏭️  Skipping already synced session`);
        skippedCount++;
        continue;
      }

      // Create time entry for sleep session
      const description = `🛌 Sleep - ${durationHours}h ${durationMinutes}m (${sleepSession.efficiency}% efficiency) [Oura:${sessionId}]`;

      try {
        await clockifyService.createTimeEntry({
          start: sleepSession.bedtime_start,
          end: sleepSession.bedtime_end,
          billable: false,
          description: description,
        });

        console.log(
          `✅ Synced sleep session: ${sleepSession.day} - ${durationHours}h ${durationMinutes}m`
        );
        syncedCount++;

        // Add delay after successful API call to avoid rate limiting
        await sleep(env.CLOCKIFY_API_DELAY);
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        console.error(`❌ Failed to sync session ${sleepSession.day}:`, errorMessage);
        failedCount++;

        // If we hit rate limit, wait longer before continuing
        if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
          console.log('⏸️  Rate limit hit, waiting 200ms before continuing...');
          await sleep(200);
        }
      }
    }

    console.log(`\n🎉 Sync complete!`);
    console.log(`   - Oura sleep sessions: ${sleepData.data.length}`);
    console.log(`   - Newly synced: ${syncedCount}`);
    console.log(`   - Already existed: ${skippedCount}`);
    console.log(`   - Failed: ${failedCount}`);
    console.log(
      `   - Total in Clockify now: ${existingSleepEntries.length + syncedCount} sleep entries`
    );
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
 * Start OAuth2 server for authentication
 */
async function startOAuth2Server(): Promise<void> {
  const ouraService = createOuraService();
  const clockifyService = createClockifyService(env.CLOCKIFY_API_TOKEN);

  const app = new Hono();
  const state = crypto.randomBytes(16).toString('hex');

  app.get('/callback', async (c) => {
    const { code, state: returnedState, error } = c.req.query();

    if (error) {
      return c.html(`<h1>Authentication Failed</h1><p>Error: ${error}</p>`);
    }

    if (returnedState !== state) {
      return c.html('<h1>Authentication Failed</h1><p>Invalid state parameter</p>');
    }

    try {
      const tokenData = await ouraService.exchangeCodeForToken(code as string);
      console.log('\n✅ OAuth2 authentication successful!');
      console.log('Access token received. Token expires in:', tokenData.expires_in, 'seconds');

      // Save tokens for future automated use
      if (tokenData.refresh_token) {
        const expiresAt = Date.now() + tokenData.expires_in * 1000 - 60 * 1000;
        const tokenStorage = {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: expiresAt,
        };

        saveTokens(tokenStorage);
        console.log('💾 Tokens saved for future automated syncs');
      }

      const html = c.html(`
        <h1>Authentication Successful!</h1>
        <p>Starting sync to Clockify...</p>
        <p>Check your terminal for progress.</p>
        <script>setTimeout(() => window.close(), 3000);</script>
      `);

      // Set the access token in the service and sync to Clockify
      ouraService.setAccessToken(tokenData.access_token);
      await syncSleepToClockify(ouraService, clockifyService);

      process.exit(0);
      return html;
    } catch (error) {
      console.error('OAuth2 error:', error);
      return c.html('<h1>Authentication Failed</h1><p>Failed to exchange code for token</p>');
    }
  });

  serve({
    fetch: app.fetch,
    port: env.SERVER_PORT,
  });
  
  const authUrl = ouraService.generateAuthUrl(state);
  console.log('\n🔐 OAuth2 Authentication');
  console.log('\nPlease visit the following URL to authenticate:');
  console.log(`\n${authUrl}`);
  console.log('\nWaiting for authentication...');
}

// Main execution
async function main() {
  console.log('🛌 Oura Sleep Tracker → Clockify Sync\n');
  console.log('This tool will sync your Oura sleep data to Clockify as time entries.\n');

  // Start OAuth2 flow
  await startOAuth2Server();
}

// Run the main function
main().catch(console.error);