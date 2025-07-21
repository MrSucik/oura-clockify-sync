import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import * as cron from 'node-cron';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { validateEnvironment } from '../config/env';
import { getErrorMessage, isProcessError } from '../utils/common';
import { loadTokens } from '../utils/token';

// Validate environment on startup
const env = validateEnvironment();

// Configuration
const LOG_DIR = env.LOG_DIR;
const LOG_FILE = `${LOG_DIR}/server.log`;
const PORT = process.env.PORT || 8080;

// Schedule configuration
const SYNC_SCHEDULE = process.env.SYNC_SCHEDULE || '0 */6 * * *'; // Default: every 6 hours
const SYNC_DAYS = parseInt(process.env.SYNC_DAYS || '1', 10);

// Application state
let isHealthy = true;
let lastSyncTime: Date | null = null;
let lastSyncStatus: 'success' | 'failed' | 'pending' | null = null;
let syncCount = 0;
let failureCount = 0;

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function log(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}`;

  console.log(logMessage);

  ensureLogDir();
  fs.appendFileSync(LOG_FILE, `${logMessage}\n`);
}

// Check if tokens exist and are valid
function checkTokens(): boolean {
  try {
    const tokens = loadTokens();

    if (!tokens) {
      log('No tokens found. Please set OURA_ACCESS_TOKEN, OURA_REFRESH_TOKEN, and OURA_TOKEN_EXPIRES_AT in environment variables or run "npm start" to authenticate.', 'ERROR');
      return false;
    }

    if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_at) {
      log('Token file is missing required fields. Please re-authenticate.', 'ERROR');
      return false;
    }

    log('Tokens found and structure is valid', 'INFO');
    return true;
  } catch (error) {
    log(`Error checking tokens: ${error}`, 'ERROR');
    return false;
  }
}

// Run the sync
async function runSync(syncDays: number) {
  const startTime = Date.now();
  lastSyncStatus = 'pending';
  log(`🔄 Starting sync (${syncDays} day${syncDays > 1 ? 's' : ''})`);

  try {
    // Run the auto-sync script
    const result = execSync(`SYNC_DAYS=${syncDays} npm run auto-sync`, {
      encoding: 'utf-8',
      timeout: 300000, // 5 minute timeout
      cwd: process.cwd(),
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`✅ Sync completed successfully in ${duration}s`);

    // Update state
    lastSyncTime = new Date();
    lastSyncStatus = 'success';
    syncCount++;

    // Log the result (first few lines only to avoid spam)
    const lines = result.trim().split('\n');
    const summaryLines = lines.filter(
      (line) =>
        line.includes('Sync complete') ||
        line.includes('synced:') ||
        line.includes('Already existed:') ||
        line.includes('Failed:')
    );

    if (summaryLines.length > 0) {
      summaryLines.forEach((line) => log(`   ${line.trim()}`));
    }
  } catch (error: unknown) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`❌ Sync failed after ${duration}s: ${getErrorMessage(error)}`, 'ERROR');

    // Update state
    lastSyncTime = new Date();
    lastSyncStatus = 'failed';
    failureCount++;

    // Log stderr if available
    if (isProcessError(error)) {
      const errorLines = error.stderr.split('\n').slice(0, 5); // First 5 lines
      errorLines.forEach((line: string) => {
        if (line.trim()) {
          log(`   ${line.trim()}`, 'ERROR');
        }
      });
    }

    // Mark unhealthy if too many failures
    if (failureCount >= 3) {
      isHealthy = false;
      log('Service marked unhealthy due to repeated failures', 'ERROR');
    }
  }
}

// Create Hono app
const app = new Hono();

// Health check endpoint
app.get('/health', (c) => {
  const health = {
    status: isHealthy ? 'healthy' : 'unhealthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    syncSchedule: SYNC_SCHEDULE,
    syncDays: SYNC_DAYS,
    lastSync: lastSyncTime ? lastSyncTime.toISOString() : null,
    lastSyncStatus: lastSyncStatus,
    totalSyncs: syncCount,
    failedSyncs: failureCount,
    tokensValid: checkTokens(),
  };

  const statusCode = isHealthy && health.tokensValid ? 200 : 503;
  return c.json(health, statusCode);
});

// Liveness check endpoint (simpler, always returns 200 if service is running)
app.get('/health/liveness', (c) => {
  return c.json({ status: 'alive', timestamp: new Date().toISOString() }, 200);
});

// Readiness check endpoint (returns 200 only if tokens are valid)
app.get('/health/readiness', (c) => {
  const tokensValid = checkTokens();
  const statusCode = tokensValid ? 200 : 503;
  return c.json({
    status: tokensValid ? 'ready' : 'not ready',
    tokensValid,
    timestamp: new Date().toISOString(),
  }, statusCode);
});

// Status endpoint
app.get('/status', (c) => {
  return c.json({
    service: 'Oura Sleep Tracker',
    version: '1.0.0',
    environment: {
      syncSchedule: SYNC_SCHEDULE,
      syncDays: SYNC_DAYS,
      logFile: LOG_FILE,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    statistics: {
      uptime: process.uptime(),
      lastSync: lastSyncTime ? lastSyncTime.toISOString() : null,
      lastSyncStatus: lastSyncStatus,
      totalSyncs: syncCount,
      failedSyncs: failureCount,
    },
  });
});

// Main function to start the server
async function main() {
  log('🚀 Starting Oura Sleep Tracker Server');
  log(`Schedule: ${SYNC_SCHEDULE}`);
  log(`Sync days: ${SYNC_DAYS}`);
  log(`Port: ${PORT}`);

  // Check tokens before starting
  if (!checkTokens()) {
    log('Server starting without valid tokens. Please authenticate first.', 'WARN');
    isHealthy = false;
  }

  // Validate cron expression
  if (!cron.validate(SYNC_SCHEDULE)) {
    log(`Invalid cron schedule: ${SYNC_SCHEDULE}`, 'ERROR');
    process.exit(1);
  }

  // Schedule the sync task
  const task = cron.schedule(
    SYNC_SCHEDULE,
    () => {
      runSync(SYNC_DAYS);
    },
    {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
  );

  log(`✅ Scheduler started with timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

  // Run initial sync if tokens are valid
  if (checkTokens()) {
    log('Running initial sync...');
    await runSync(SYNC_DAYS);
  }

  // Start Hono server
  const server = serve({
    fetch: app.fetch,
    port: Number(PORT),
  });
  
  log(`✅ Server listening on port ${PORT}`);
  log(`Health check available at http://localhost:${PORT}/health`);

  // Handle graceful shutdown
  const shutdown = (signal: string) => {
    log(`🛑 ${signal} received, shutting down gracefully...`);
    
    // Stop accepting new connections
    server.close(() => {
      log('HTTP server closed');
    });

    // Stop the cron job
    task.stop();
    log('Scheduler stopped');

    // Exit after cleanup
    setTimeout(() => {
      log('Forced shutdown after 10 seconds');
      process.exit(0);
    }, 10000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Start the server
main().catch((error) => {
  log(`Fatal error: ${error}`, 'ERROR');
  process.exit(1);
});