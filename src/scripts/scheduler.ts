import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as cron from 'node-cron';
import { validateEnvironment } from '../config/env';
import { getErrorMessage, isProcessError } from '../utils/common';
import { loadTokens } from '../utils/token';

// Validate environment on startup
const env = validateEnvironment();

// Configuration
interface ScheduleConfig {
  schedule: string;
  syncDays: number;
  description: string;
}

const SCHEDULES: Record<string, ScheduleConfig> = {
  'every-minute': {
    schedule: '* * * * *',
    syncDays: 1,
    description: 'Every minute (testing)',
  },
  'every-5min': {
    schedule: '*/5 * * * *',
    syncDays: 1,
    description: 'Every 5 minutes',
  },
  'every-30min': {
    schedule: '*/30 * * * *',
    syncDays: 1,
    description: 'Every 30 minutes',
  },
  hourly: {
    schedule: '0 * * * *',
    syncDays: 1,
    description: 'Every hour',
  },
  'every-6h': {
    schedule: '0 */6 * * *',
    syncDays: 1,
    description: 'Every 6 hours',
  },
  daily: {
    schedule: '0 6 * * *',
    syncDays: 2,
    description: 'Daily at 6:00 AM',
  },
  'twice-daily': {
    schedule: '0 9,21 * * *',
    syncDays: 1,
    description: 'Twice daily (9 AM & 9 PM)',
  },
};

// Logging utilities from environment
const LOG_DIR = env.LOG_DIR;
const LOG_FILE = `${LOG_DIR}/scheduler.log`;

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
      log('No token file found. Please run "npm start" first to authenticate.', 'ERROR');
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

    // Log stderr if available
    if (isProcessError(error)) {
      const errorLines = error.stderr.split('\n').slice(0, 5); // First 5 lines
      errorLines.forEach((line: string) => {
        if (line.trim()) {
          log(`   ${line.trim()}`, 'ERROR');
        }
      });
    }
  }
}

function showUsage() {
  console.log('\n🕐 Oura Sleep Tracker Scheduler\n');
  console.log('Usage: npm run schedule [schedule-name]\n');
  console.log('Available schedules:');

  Object.entries(SCHEDULES).forEach(([key, config]) => {
    console.log(`  ${key.padEnd(15)} - ${config.description} (${config.schedule})`);
  });

  console.log('\nExamples:');
  console.log('  npm run schedule every-minute   # For testing');
  console.log('  npm run schedule hourly         # Every hour');
  console.log('  npm run schedule daily          # Daily at 6 AM');
  console.log('\nThe scheduler will run until stopped with Ctrl+C');
}

async function main() {
  const scheduleName = process.argv[2];

  if (!scheduleName || scheduleName === '--help' || scheduleName === '-h') {
    showUsage();
    process.exit(0);
  }

  if (!SCHEDULES[scheduleName]) {
    console.error(`❌ Unknown schedule: ${scheduleName}`);
    showUsage();
    process.exit(1);
  }

  const config = SCHEDULES[scheduleName];

  // Check tokens before starting
  if (!checkTokens()) {
    process.exit(1);
  }

  log('🚀 Starting Oura Sleep Tracker Scheduler');
  log(`Schedule: ${config.description}`);
  log(`Cron pattern: ${config.schedule}`);
  log(`Sync days: ${config.syncDays}`);
  log(`Log file: ${LOG_FILE}`);
  log('Press Ctrl+C to stop the scheduler');

  // Validate cron expression
  if (!cron.validate(config.schedule)) {
    log(`Invalid cron schedule: ${config.schedule}`, 'ERROR');
    process.exit(1);
  }

  // Schedule the task
  const task = cron.schedule(
    config.schedule,
    () => {
      runSync(config.syncDays);
    },
    {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
  );

  // The task is automatically started by default
  log(`✅ Scheduler started with timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

  // Run initial sync if requested
  if (process.argv.includes('--run-now')) {
    log('Running initial sync...');
    await runSync(config.syncDays);
  }

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    log('🛑 Scheduler stopping...');
    task.stop();
    log('✅ Scheduler stopped');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('🛑 Scheduler terminating...');
    task.stop();
    log('✅ Scheduler terminated');
    process.exit(0);
  });

  // Keep the process alive
  process.stdin.resume();
}

// Run the scheduler
main().catch((error) => {
  log(`Fatal error: ${error}`, 'ERROR');
  process.exit(1);
});
