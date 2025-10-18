# Quick Start Guide

## 1. Initial Setup

### Install dependencies:
```bash
npm install
```

### Set up environment variables:
```bash
cp env.example .env
# Edit .env file with ALL required variables (no defaults provided)
# Replace 'your_*_here' placeholders with actual values
```

**⚠️ IMPORTANT**: All environment variables are required. The app will not start with missing variables.

### Authenticate with Oura:
```bash
npm start
```

This will:
- Validate your environment configuration
- Open your browser for OAuth authentication
- Save tokens for future automated syncs
- Perform initial sync of all historical data

## 2. Test Every-Minute Sync

Start the scheduler to run every minute (perfect for testing):

```bash
npm run schedule every-minute
```

You'll see output like:
```
🚀 Starting Oura Clockify Sync Scheduler
Schedule: Every minute (testing)
Cron pattern: * * * * *
Sync days: 1
```

Watch the logs to see it sync every minute. Press `Ctrl+C` to stop.

## 3. Production Setup

For production, run as a background daemon:

```bash
# Start daily sync at 6 AM
npm run daemon start daily

# Check if it's running
npm run daemon status

# View logs
npm run daemon logs

# Stop when needed
npm run daemon stop
```

## 4. Monitoring

```bash
# Check token status
npm run verify

# View recent logs
npm run daemon logs

# Follow live logs
npm run daemon logs -f
```

## Common Schedules

- **Testing**: `npm run schedule every-minute`
- **Frequent**: `npm run schedule hourly`
- **Production**: `npm run daemon start daily`
- **Conservative**: `npm run daemon start twice-daily`

That's it! The sync will automatically handle token refresh and only sync new sleep data. 