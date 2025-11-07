import * as crypto from 'node:crypto';
import * as http from 'node:http';
import { validateEnvironment } from '../config/env';
import { createClockifyService } from '../services/clockify-service';
import { createOuraService } from '../services/oura-service';
import { syncSleepToClockify } from '../services/sync-service';

// Validate environment on startup
const env = validateEnvironment();

/**
 * Sync sleep data from Oura to Clockify with progress bar
 */
async function syncSleepToClockifyWithProgress(
  ouraService: Awaited<ReturnType<typeof createOuraService>>,
  clockifyService: ReturnType<typeof createClockifyService>
): Promise<void> {
  await syncSleepToClockify(ouraService, clockifyService, env, { showProgressBar: true });
}

/**
 * Start OAuth2 server for authentication
 */
async function startOAuth2Server(): Promise<void> {
  const ouraService = await createOuraService();
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

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication Failed</h1><p>No authorization code received</p>');
        return;
      }

      try {
        // Exchange code for access token
        const tokenData = await ouraService.exchangeCodeForToken(code);

        console.log('\n✅ Authentication successful!');
        console.log('=============================');
        console.log('Access token received successfully!');
        console.log('Copy these values to your Coolify environment:');
        console.log('\nOURA_ACCESS_TOKEN=');
        console.log(tokenData.access_token);

        if (tokenData.refresh_token) {
          console.log('\nOURA_REFRESH_TOKEN=');
          console.log(tokenData.refresh_token);
        } else {
          console.log('\n⚠️  No refresh token received from Oura');
          console.log("This may happen if you're re-authenticating with the same app");
        }
        console.log('\n=============================\n');

        // Set access token in service and sync to Clockify
        ouraService.setAccessToken(tokenData.access_token);

        // Start sync process asynchronously
        syncSleepToClockifyWithProgress(ouraService, clockifyService)
          .then(() => {
            console.log('\n✨ Sync completed successfully!');
            // Wait a bit before exiting to ensure everything is properly closed
            setTimeout(() => {
              server.close();
              process.exit(0);
            }, 5000);
          })
          .catch((error) => {
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
      } catch (_error) {
        console.error('OAuth2 error:', error);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication Failed</h1><p>Failed to exchange code for token</p>');
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  // Construct authorization URL
  const authUrl = ouraService.generateAuthUrl(state);

  console.log('🔗 Opening browser for authentication...');
  console.log(`   If browser doesn't open automatically, visit: ${authUrl}`);

  // Try to open browser
  try {
    const { exec } = await import('node:child_process');
    const platform = process.platform;
    const command =
      platform === 'darwin'
        ? `open "${authUrl}"`
        : platform === 'win32'
          ? `start "${authUrl}"`
          : `xdg-open "${authUrl}"`;

    exec(command);
  } catch {
    // Fallback: just display the URL
    console.log(`\nPlease manually visit: ${authUrl}`);
  }

  // Start server
  server.listen(env.SERVER_PORT, () => {
    console.log(`\n🌐 OAuth2 server listening on http://localhost:${env.SERVER_PORT}`);
    console.log('   Waiting for authentication callback...\n');
  });
}

/**
 * Main function
 */
async function main() {
  console.log('🛌 Oura Clockify Sync - Manual Sync\n');
  console.log('This tool will sync your Oura sleep data to Clockify as time entries.\n');

  const ouraService = await createOuraService();
  const clockifyService = createClockifyService(env.CLOCKIFY_API_TOKEN);

  if (ouraService.hasAccessToken()) {
    console.log('✅ Found existing access token in environment');
    console.log('   Skipping OAuth flow...\n');

    // Directly sync sleep data
    try {
      await syncSleepToClockifyWithProgress(ouraService, clockifyService);
      process.exit(0);
    } catch (_error) {
      console.error('\n❌ Sync failed: cached token may have expired or is invalid.');
      console.error(
        '   Please remove OURA_ACCESS_TOKEN and OURA_REFRESH_TOKEN from your .env file'
      );
      console.error('   and re-run tool to re-authenticate.\n');
      process.exit(1);
    }
  }

  // No token found, start OAuth2 flow
  console.log('⚠️  No access token found in environment');
  console.log('   Starting OAuth2 authentication flow...\n');
  await startOAuth2Server();
}

// Run main function
main().catch(console.error);
