import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as cliProgress from 'cli-progress';
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

    console.log('📊 Processing sleep sessions...\n');

    // Create progress bar
    const progressBar = new cliProgress.SingleBar({
      format: '⏳ Progress |{bar}| {percentage}% | {value}/{total} Sessions | {day}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    });

    progressBar.start(sleepData.data.length, 0, {
      day: 'Starting...'
    });

    for (let i = 0; i < sleepData.data.length; i++) {
      const sleepSession = sleepData.data[i];
      
      // Create unique session ID
      const sessionId = createSessionId(sleepSession.bedtime_start, sleepSession.day);

      // Update progress bar
      progressBar.update(i + 1, {
        day: sleepSession.day
      });

      // Check if already synced
      if (await clockifyService.isSessionSynced(sessionId, existingEntries)) {
        skippedCount++;
        continue;
      }

      // Create time entry for sleep session
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

        // Add delay after successful API call to avoid rate limiting
        await sleep(env.CLOCKIFY_API_DELAY);
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        failedCount++;

        // If we hit rate limit, wait longer before continuing
        if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
          await sleep(200);
        }
      }
    }

    // Stop the progress bar
    progressBar.stop();

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
  const state = crypto.randomBytes(16).toString('hex');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '', `http://localhost:${env.SERVER_PORT}`);
    
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>Authentication Failed</h1><p>Error: ${error}</p>`);
        return;
      }

      if (returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication Failed</h1><p>Invalid state parameter</p>');
        return;
      }

      try {
        const tokenData = await ouraService.exchangeCodeForToken(code as string);
        console.log('\n✅ OAuth2 authentication successful!');
        console.log('Access token received. Token expires in:', tokenData.expires_in, 'seconds');

        // Log tokens for manual configuration in Coolify
        console.log('\n🔑 === AUTHENTICATION TOKENS ===');
        console.log('Copy these values to your Coolify environment:');
        console.log('\nOURA_ACCESS_TOKEN=');
        console.log(tokenData.access_token);
        
        if (tokenData.refresh_token) {
          console.log('\nOURA_REFRESH_TOKEN=');
          console.log(tokenData.refresh_token);
        } else {
          console.log('\n⚠️  No refresh token received from Oura');
          console.log('This may happen if you\'re re-authenticating with the same app');
        }
        console.log('\n=============================\n');

        // Set the access token in the service and sync to Clockify
        ouraService.setAccessToken(tokenData.access_token);
        
        // Start sync process asynchronously
        syncSleepToClockify(ouraService, clockifyService).then(() => {
          console.log('\n✨ Sync completed successfully!');
          // Wait a bit before exiting to ensure everything is properly closed
          setTimeout(() => {
            server.close();
            process.exit(0);
          }, 5000);
        }).catch((error) => {
          console.error('\n❌ Sync failed:', error);
          setTimeout(() => {
            server.close();
            process.exit(1);
          }, 5000);
        });

        // Return response immediately
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <h1>Authentication Successful!</h1>
          <p>Starting sync to Clockify...</p>
          <p>Check your terminal for progress.</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        `);
      } catch (error) {
        console.error('OAuth2 error:', error);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication Failed</h1><p>Failed to exchange code for token</p>');
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(env.SERVER_PORT, () => {
    const authUrl = ouraService.generateAuthUrl(state);
    console.log('\n🔐 OAuth2 Authentication');
    console.log('\nPlease visit the following URL to authenticate:');
    console.log(`\n${authUrl}`);
    console.log('\nWaiting for authentication...');
  });
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