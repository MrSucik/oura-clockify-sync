import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { validateEnvironment } from './config/env';
import { syncSleepToClockifyExport } from './scripts/sync';
import { createClockifyService } from './services/clockify-service';
import { createOuraService } from './services/oura-service';

const env = validateEnvironment();
const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Add Basic Auth middleware for sync endpoint
app.use(
  '/sync',
  basicAuth({
    username: env.BASIC_AUTH_USERNAME,
    password: env.BASIC_AUTH_PASSWORD,
  })
);

// Health check and status endpoint
app.get('/', async (c) => {
  const ouraService = await createOuraService();
  const hasOuraToken = ouraService.hasAccessToken();
  const hasClockifyToken = !!env.CLOCKIFY_API_TOKEN;

  // Check if client wants HTML
  const acceptHeader = c.req.header('accept') || '';
  const wantsHtml = acceptHeader.includes('text/html');

  if (wantsHtml) {
    // Return simple HTML interface with basic styling
    return c.html(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Oura Clockify Sync</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 0 auto;
            padding: 40px 20px;
            text-align: center;
            background: #f5f5f5;
          }
          h1 {
            color: #333;
            margin-bottom: 30px;
          }
          h2 {
            color: #555;
            margin-bottom: 15px;
          }
          .status-item {
            background: white;
            border: 1px solid #e1e5e9;
            border-radius: 8px;
            padding: 15px;
            margin: 10px 0;
            text-align: left;
          }
          .configured {
            color: #28a745;
          }
          .needs-auth {
            color: #dc3545;
          }
          .sync-form {
            margin: 20px 0;
          }
          .btn {
            background: #007bff;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            text-decoration: none;
          }
          .btn:hover {
            background: #0056b3;
          }
          .btn:disabled {
            background: #6c757d;
            cursor: not-allowed;
          }
          .auth-link {
            display: inline-block;
            margin-top: 10px;
          }
        </style>
      </head>
      <body>
        <h1>🛌 Oura Clockify Sync</h1>
        
        <h2>📊 Status</h2>
        <div class="status-item">
          <strong>Oura API:</strong> 
          <span class="${hasOuraToken ? 'configured' : 'needs-auth'}">
            ${hasOuraToken ? '✅ Configured' : '❌ Needs Authentication'}
          </span>
        </div>
        <div class="status-item">
          <strong>Clockify API:</strong>
          <span class="${hasClockifyToken ? 'configured' : 'needs-auth'}">
            ${hasClockifyToken ? '✅ Configured' : '❌ Needs Token'}
          </span>
        </div>

        <h2>🔄 Sync Actions</h2>
        <div class="sync-form">
          <form action="/sync" method="post">
            <button type="submit" class="btn" ${!hasOuraToken || !hasClockifyToken ? 'disabled' : ''}>
              Start Manual Sync
            </button>
          </form>
        </div>
        
        <div class="auth-link">
          <a href="/auth" class="btn">🔐 Authenticate with Oura</a>
        </div>
      </body>
      </html>
    `);
  }

  // Return JSON for API clients
  return c.json({
    name: 'Oura Clockify Sync',
    status: 'healthy',
    version: '1.0.0',
    authentication: {
      oura: {
        configured: hasOuraToken,
        status: hasOuraToken ? 'configured' : 'needs_authentication',
      },
      clockify: {
        configured: hasClockifyToken,
        status: hasClockifyToken ? 'configured' : 'needs_token',
      },
    },
    environment: {
      node_env: env.NODE_ENV,
      server_port: env.SERVER_PORT,
      sync_days: env.SYNC_DAYS,
    },
    endpoints: {
      health: '/',
      sync: '/sync',
      auth: '/auth',
      'oauth-callback': '/callback',
    },
  });
});

// Manual sync endpoint
app.post('/sync', async (c) => {
  try {
    const ouraService = await createOuraService();
    const clockifyService = createClockifyService(env.CLOCKIFY_API_TOKEN);

    if (!ouraService.hasAccessToken()) {
      return c.json(
        {
          error: 'Oura access token not configured',
          message: 'Please authenticate with Oura first',
        },
        400
      );
    }

    // Start sync in background
    syncSleepToClockifyExport(ouraService, clockifyService)
      .then(() => {
        console.log('✅ Background sync completed successfully');
      })
      .catch((error: unknown) => {
        console.error('❌ Background sync failed:', error);
      });

    return c.json({
      message: 'Sync started',
      status: 'running',
    });
  } catch (error: unknown) {
    console.error('Sync endpoint error:', error);
    return c.json(
      {
        error: 'Failed to start sync',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// OAuth callback handler (reuses existing logic)
app.get('/callback', async (c) => {
  const code = c.req.query('code');
  const _state = c.req.query('state');
  const error = c.req.query('error');

  if (error) {
    return c.html(`<h1>Authentication Failed</h1><p>Error: ${error}</p>`, 400);
  }

  if (!code) {
    return c.html('<h1>Authentication Failed</h1><p>No authorization code received</p>', 400);
  }

  try {
    const ouraService = await createOuraService();
    const tokenData = await ouraService.exchangeCodeForToken(code);

    console.log('\n✅ OAuth2 authentication successful!');
    console.log('Access token received. Token expires in:', tokenData.expires_in, 'seconds');

    // Set the access token
    ouraService.setAccessToken(tokenData.access_token);

    // Start sync process
    const clockifyService = createClockifyService(env.CLOCKIFY_API_TOKEN);
    syncSleepToClockifyExport(ouraService, clockifyService)
      .then(() => {
        console.log('\n✨ Sync completed successfully!');
      })
      .catch((error: unknown) => {
        console.error('\n❌ Sync failed:', error);
      });

    return c.html(`
      <h1>Authentication Successful!</h1>
      <p>Your Oura account has been connected.</p>
      <p>Starting sync to Clockify...</p>
      <p>Check the server logs for progress.</p>
      <script>
        setTimeout(() => {
          window.close();
          if (window.opener) {
            window.opener.postMessage({ type: 'auth-success' }, '*');
          }
        }, 3000);
      </script>
    `);
  } catch (error: unknown) {
    console.error('Auth endpoint error:', error);
    return c.json(
      {
        error: 'Failed to generate auth URL',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// OAuth initiation endpoint
app.get('/auth', async (c) => {
  try {
    const ouraService = await createOuraService();
    const authUrl = ouraService.generateAuthUrl(Math.random().toString(36).substring(2, 15));

    // Redirect to Oura OAuth URL
    return c.redirect(authUrl);
  } catch (error: unknown) {
    console.error('Auth endpoint error:', error);
    return c.html(
      `
      <h1>Authentication Failed</h1>
      <p>Failed to generate authentication URL: ${error instanceof Error ? error.message : 'Unknown error'}</p>
      <a href="/">Back to home</a>
    `,
      500
    );
  }
});

// Start server
const port = env.SERVER_PORT;
const runMode = process.env.RUN_MODE || 'both';

async function startServer(): Promise<void> {
  console.log(`✅ Web server running on http://localhost:${port}`);

  serve({
    fetch: app.fetch,
    port,
  }).on('listening', () => {
    console.log('\n📋 Available endpoints:');
    console.log('  GET  /           - Health check and status info');
    console.log('  GET  /auth        - Redirect to Oura authentication');
    console.log('  GET  /callback   - OAuth callback endpoint');
    console.log('  POST /sync        - Manual sync trigger');
    console.log('\n🔐 To authenticate:');
    console.log(`1. Visit http://localhost:${port}/auth`);
    console.log('2. Follow the Oura authorization URL');
    console.log('3. Complete authentication in Oura');
    console.log('4. Sync will start automatically');
  });
}

async function startScheduler(): Promise<void> {
  console.log('🚀 Starting scheduler in background');

  const { spawn } = await import('node:child_process');
  const scheduler = spawn('tsx', ['src/scripts/scheduler.ts'], {
    stdio: 'inherit',
    detached: false,
  });

  scheduler.on('error', (error) => {
    console.error('❌ Scheduler error:', error);
  });

  scheduler.on('spawn', () => {
    console.log('✅ Scheduler process started');
  });
}

async function run(): Promise<void> {
  if (runMode === 'both' || runMode === 'server') {
    console.log(`🚀 Starting Hono server on port ${port}`);
    await startServer();
  }

  if (runMode === 'both' || runMode === 'scheduler') {
    await startScheduler();
  }

  if (runMode === 'both') {
    console.log('\n⏰ Scheduler running alongside web server (hourly syncs)');
  }

  if (runMode === 'server') {
    console.log(
      '\n💡 Scheduler disabled (RUN_MODE=server). Set RUN_MODE=both to enable scheduler.'
    );
  }

  if (runMode === 'scheduler') {
    console.log('\n⚠️ Running scheduler-only mode (RUN_MODE=scheduler). Web server not started.');
  }
}

run().catch((error) => {
  console.error('❌ Failed to start services:', error);
  process.exit(1);
});
