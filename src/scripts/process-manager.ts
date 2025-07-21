import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateEnvironment } from '../config/env';

// Validate environment on startup
const env = validateEnvironment();

const PID_FILE = 'scheduler.pid';
const LOG_DIR = env.LOG_DIR;
const DAEMON_LOG = path.join(LOG_DIR, 'daemon.log');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  ensureLogDir();
  fs.appendFileSync(DAEMON_LOG, logMessage);
  console.log(logMessage.trim());
}

function getPid(): number | null {
  try {
    if (fs.existsSync(PID_FILE)) {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
      return Number.isNaN(pid) ? null : pid;
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function setPid(pid: number) {
  fs.writeFileSync(PID_FILE, pid.toString());
}

function removePid() {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch (_error) {
    // Ignore errors
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 checks if process exists
    return true;
  } catch (_error) {
    return false;
  }
}

function getStatus() {
  const pid = getPid();

  if (!pid) {
    console.log('❌ Scheduler is not running (no PID file)');
    return false;
  }

  if (isProcessRunning(pid)) {
    console.log(`✅ Scheduler is running (PID: ${pid})`);
    console.log(`📊 Logs: ${DAEMON_LOG}`);
    console.log(`🗂️  Scheduler logs: ${path.join(LOG_DIR, 'scheduler.log')}`);
    return true;
  } else {
    console.log(`❌ Scheduler is not running (stale PID: ${pid})`);
    removePid();
    return false;
  }
}

function start(schedule: string) {
  const pid = getPid();

  if (pid && isProcessRunning(pid)) {
    console.log(`❌ Scheduler is already running (PID: ${pid})`);
    return;
  }

  log(`Starting scheduler with schedule: ${schedule}`);

  // Clean up stale PID file
  removePid();

  // Start the scheduler process
  const child = spawn('npx', ['tsx', 'src/scripts/scheduler.ts', schedule], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!child.pid) {
    console.log('❌ Failed to start scheduler');
    return;
  }

  setPid(child.pid);

  // Redirect output to daemon log
  child.stdout?.on('data', (data) => {
    fs.appendFileSync(DAEMON_LOG, data);
  });

  child.stderr?.on('data', (data) => {
    fs.appendFileSync(DAEMON_LOG, data);
  });

  child.on('exit', (code) => {
    log(`Scheduler exited with code: ${code}`);
    removePid();
  });

  // Detach from parent
  child.unref();

  console.log(`✅ Scheduler started as daemon (PID: ${child.pid})`);
  console.log(`📊 Daemon logs: ${DAEMON_LOG}`);
  console.log(`🗂️  Scheduler logs: ${path.join(LOG_DIR, 'scheduler.log')}`);
}

function stop() {
  const pid = getPid();

  if (!pid) {
    console.log('❌ Scheduler is not running');
    return;
  }

  if (!isProcessRunning(pid)) {
    console.log('❌ Scheduler is not running (stale PID)');
    removePid();
    return;
  }

  log(`Stopping scheduler (PID: ${pid})`);

  try {
    process.kill(pid, 'SIGTERM');
    console.log('✅ Scheduler stop signal sent');

    // Wait a bit and check if it stopped
    setTimeout(() => {
      if (!isProcessRunning(pid)) {
        console.log('✅ Scheduler stopped successfully');
        removePid();
      } else {
        console.log('⚠️  Scheduler still running, trying SIGKILL');
        try {
          process.kill(pid, 'SIGKILL');
          removePid();
          console.log('✅ Scheduler force-killed');
        } catch (_error) {
          console.log('❌ Failed to force-kill scheduler');
        }
      }
    }, 2000);
  } catch (error) {
    console.log(`❌ Failed to stop scheduler: ${error}`);
  }
}

function restart(schedule: string) {
  console.log('🔄 Restarting scheduler...');
  stop();
  setTimeout(() => start(schedule), 3000);
}

function showLogs(follow: boolean = false) {
  const logFile = path.join(LOG_DIR, 'scheduler.log');

  if (!fs.existsSync(logFile)) {
    console.log('❌ No scheduler logs found');
    return;
  }

  if (follow) {
    console.log(`📖 Following logs from: ${logFile}`);
    console.log('Press Ctrl+C to stop following\n');

    const tail = spawn('tail', ['-f', logFile], {
      stdio: 'inherit',
    });

    process.on('SIGINT', () => {
      tail.kill();
      process.exit(0);
    });
  } else {
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').slice(-50); // Last 50 lines
    console.log(`📖 Last 50 lines from: ${logFile}\n`);
    console.log(lines.join('\n'));
  }
}

function showUsage() {
  console.log('\n🔧 Oura Sleep Tracker Process Manager\n');
  console.log('Usage: npm run daemon <command> [options]\n');
  console.log('Commands:');
  console.log('  start <schedule>  - Start scheduler daemon');
  console.log('  stop              - Stop scheduler daemon');
  console.log('  restart <schedule>- Restart scheduler daemon');
  console.log('  status            - Check daemon status');
  console.log('  logs              - Show recent logs');
  console.log('  logs -f           - Follow logs (tail -f)');
  console.log('\nSchedule options:');
  console.log('  every-minute, every-5min, every-30min, hourly,');
  console.log('  every-6h, daily, twice-daily');
  console.log('\nExamples:');
  console.log('  npm run daemon start every-minute');
  console.log('  npm run daemon status');
  console.log('  npm run daemon logs -f');
  console.log('  npm run daemon stop');
}

function main() {
  const command = process.argv[2];
  const schedule = process.argv[3];
  const flag = process.argv[3];

  switch (command) {
    case 'start':
      if (!schedule) {
        console.log('❌ Schedule is required for start command');
        showUsage();
        process.exit(1);
      }
      start(schedule);
      break;

    case 'stop':
      stop();
      break;

    case 'restart':
      if (!schedule) {
        console.log('❌ Schedule is required for restart command');
        showUsage();
        process.exit(1);
      }
      restart(schedule);
      break;

    case 'status':
      getStatus();
      break;

    case 'logs':
      showLogs(flag === '-f');
      break;

    default:
      showUsage();
      break;
  }
}

main();
