import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { HonoAdapter } from '@bull-board/hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { validateEnvironment } from './config/env';
import { closeRedisConnection } from './config/redis';
import { closeSyncQueue, getSyncQueue } from './queues/sync-queue';
import { createOuraService } from './services/oura-service';
import { closeSyncWorker, createSyncWorker } from './workers/sync-worker';

const env = validateEnvironment();
const app = new Hono();

// Initialize BullMQ queue and worker
const syncQueue = getSyncQueue();
const _syncWorker = createSyncWorker();

// Setup Bull Board for monitoring
const serverAdapter = new HonoAdapter(serveStatic);
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(syncQueue)],
  serverAdapter,
});

// Middleware
app.use('*', logger());
app.use('*', cors());

// Mount Bull Board routes - use the adapter's registered plugin as a sub-app
const bullBoardApp = serverAdapter.registerPlugin();
app.route('/admin/queues', bullBoardApp);

// Add Basic Auth middleware for all endpoints except OAuth callback
app.use('*', async (c, next) => {
  // Skip auth for OAuth callback endpoint
  if (c.req.path === '/callback') {
    return next();
  }

  // Apply basic auth to all other endpoints
  const auth = basicAuth({
    username: env.BASIC_AUTH_USERNAME,
    password: env.BASIC_AUTH_PASSWORD,
  });

  return auth(c, next);
});

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

        <div class="auth-link" style="margin-left: 10px;">
          <a href="/admin/queues" class="btn" style="background: #6c757d;">📊 Job Queue Dashboard</a>
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

    if (!ouraService.hasAccessToken()) {
      return c.json(
        {
          error: 'Oura access token not configured',
          message: 'Please authenticate with Oura first',
        },
        400
      );
    }

    // Add job to queue
    const job = await syncQueue.add('sync', {
      triggeredBy: 'manual',
      timestamp: new Date().toISOString(),
    });

    return c.json({
      message: 'Sync job added to queue',
      status: 'queued',
      jobId: job.id,
    });
  } catch (error: unknown) {
    console.error('Sync endpoint error:', error);
    return c.json(
      {
        error: 'Failed to add sync job',
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

    // Add sync job to queue
    await syncQueue.add('sync', {
      triggeredBy: 'manual',
      timestamp: new Date().toISOString(),
    });

    return c.html(`
      <h1>Authentication Successful!</h1>
      <p>Your Oura account has been connected.</p>
      <p>Sync job added to queue. Check the server logs for progress.</p>
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
        error: 'Failed to complete authentication',
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

async function setupScheduledJob(): Promise<void> {
  const schedule = process.env.SYNC_SCHEDULE || '0 * * * *'; // Default: Every hour at minute 0

  console.log(`📅 Setting up scheduled sync job`);
  console.log(`   Schedule: ${schedule}`);
  console.log(`   (${getCronDescription(schedule)})\n`);

  // Remove stale repeatable schedules before adding new one
  const repeatableJobs = await syncQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    console.log(`🧹 Removing existing repeatable job: ${job.key}`);
    await syncQueue.removeRepeatableByKey(job.key);
  }

  // Add repeatable job
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
}

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

async function startServer(): Promise<void> {
  console.log(`🚀 Starting Hono server on port ${port}`);

  // Setup scheduled job
  await setupScheduledJob();

  serve({
    fetch: app.fetch,
    port,
  }).on('listening', () => {
    console.log(`\n✅ Web server running on http://localhost:${port}`);
    console.log('\n📋 Available endpoints:');
    console.log('  GET  /                 - Health check and status info');
    console.log('  GET  /auth              - Redirect to Oura authentication');
    console.log('  GET  /callback         - OAuth callback endpoint');
    console.log('  POST /sync              - Manual sync trigger');
    console.log('  GET  /admin/queues     - BullMQ dashboard (job monitoring)');
    console.log('\n🔐 To authenticate:');
    console.log(`1. Visit http://localhost:${port}/auth`);
    console.log('2. Follow the Oura authorization URL');
    console.log('3. Complete authentication in Oura');
    console.log('4. Sync will start automatically');
    console.log(`\n📊 Monitor jobs at: http://localhost:${port}/admin/queues`);
  });
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.log('\n👋 Shutting down gracefully...');

  await closeSyncWorker();
  await closeSyncQueue();
  await closeRedisConnection();

  console.log('✅ Cleanup complete');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

startServer().catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
