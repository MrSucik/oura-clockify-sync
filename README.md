# Oura Clockify Sync

A Node.js application that syncs your Oura sleep data to Clockify as time entries. It fetches sleep sessions from Oura and creates corresponding time entries in Clockify, with built-in duplicate detection for safe repeated runs.

## Documentation

- 📖 **[Quick Start Guide](./docs/QUICKSTART.md)** - Step-by-step setup and usage guide
- 🔧 **[Environment Configuration](./docs/ENVIRONMENT.md)** - Detailed environment variables documentation
- 📋 **[API Reference](README.md#features)** - Complete feature list and usage instructions

## Features

- 🔄 **One-way sync** from Oura to Clockify
- 🔁 **Idempotent** - safe to run multiple times (detects already synced sessions)
- 📊 **Full history sync** - syncs ALL available sleep data from Oura
- 🏷️ **Unique identifiers** - each synced session is tagged with a unique Oura ID
- 🛌 **Sleep metrics** - includes sleep duration and efficiency in descriptions
- ⏱️ **Rate limiting protection** - automatic delays between API calls to avoid hitting limits
- 📂 **Project organization** - all sleep entries are assigned to a "Sleep" project
- 🔐 **Automatic token refresh** - OAuth2 tokens are automatically refreshed when expired
- 🚀 **BullMQ job queue** - reliable background job processing with Redis
- 📈 **Job monitoring** - Bull Board dashboard for real-time queue monitoring
- 🌐 **Web API** - Hono-based REST API for easy integration and management

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start Redis:**
   - Using Docker:
     ```bash
     docker run -d -p 6379:6379 redis:7-alpine
     ```
   - Or install locally from https://redis.io/download

3. **Configure environment:**
   - Copy `env.example` to `.env`:
     ```bash
     cp env.example .env
     ```
   - Edit `.env` and set all required variables (no defaults provided)
   - Replace all `your_*_here` placeholders with actual values

   ⚠️ **Important**: Required variables must be set. The application validates the environment at startup and will exit with clear error messages if any required variables are missing or invalid.

## Environment Variables

The application uses **comprehensive environment validation** with Zod at startup. Required variables have no defaults and must be provided; optional variables may be omitted. Missing required variables will cause the app to exit with detailed error messages and examples.

### Required Variables:

#### Authentication:
- `OURA_CLIENT_ID` - OAuth2 client ID from Oura
- `OURA_CLIENT_SECRET` - OAuth2 client secret from Oura
- `CLOCKIFY_API_TOKEN` - Clockify API token

#### Application:
- `NODE_ENV` - Environment (development/production/test)
- `SYNC_DAYS` - Number of days to sync (1-365)
- `SERVER_PORT` - OAuth callback server port

#### API Configuration:
- `OURA_API_BASE` - Oura API base URL
- `OURA_AUTH_BASE` - Oura OAuth base URL  
- `CLOCKIFY_API_BASE` - Clockify API base URL
- `REDIRECT_URI` - OAuth redirect URI
- `OAUTH_SCOPES` - OAuth scopes (daily)

#### Performance:
- `CLOCKIFY_API_DELAY` - Delay between API calls (ms)

#### Project Configuration:
- `SLEEP_PROJECT_NAME` - Clockify project name

#### Queue Configuration:
- `REDIS_URL` - Redis connection string (default: redis://localhost:6379)
- `SYNC_SCHEDULE` - Cron expression for scheduled syncs (default: 0 * * * *)

### Optional Variables:

#### Authentication Tokens:
- `OURA_ACCESS_TOKEN` - (Optional) Oura OAuth2 access token - if provided, skips OAuth flow
- `OURA_REFRESH_TOKEN` - (Optional) Oura OAuth2 refresh token - used to auto-refresh expired access tokens

### Getting Your Credentials:

#### Oura OAuth2:
1. Go to https://cloud.ouraring.com/oauth/applications
2. Create a new application
3. Set redirect URI to exactly `http://localhost:3000/callback`
4. Note your Client ID and Client Secret

#### Clockify API Token:
1. Go to https://app.clockify.me/user/settings
2. Scroll to API section
3. Generate or copy your API token

## Available Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| Start | `npm start` | Initial OAuth authentication & full historical sync |
| Server | `npm run server` | Start Hono web server (Docker default) |
| Dev Server | `npm run dev:server` | Development web server with file watching |
| Scheduler | `npm run scheduler` | Run automated scheduler (cron-based) |
| Auto Sync | `npm run auto-sync` | Single sync run (configurable days) |
| Schedule | `npm run schedule <schedule>` | Run scheduler with cron-like scheduling |
| Daemon | `npm run daemon <cmd> <args>` | Manage background scheduler service |
| Check Token | `npm run check-token` | Quick token status check |
| Verify | `npm run verify` | Comprehensive token & API verification |
| Cleanup | `npm run cleanup` | Remove all sleep entries from Clockify |
| Dev | `npm run dev` | Development mode with file watching |

## Running the Application

### Initial Setup (First Time Only)
You must authenticate once manually to obtain OAuth tokens:
```bash
npm start
```

This will:
1. Check if `OURA_ACCESS_TOKEN` exists in your `.env` file
2. If not found, open a browser for Oura OAuth authentication
3. Display the access token and refresh token in the console
4. Perform the initial sync of all historical data

**Important**: After the first run, copy the displayed tokens to your `.env` file:
```bash
OURA_ACCESS_TOKEN=your_access_token_here
OURA_REFRESH_TOKEN=your_refresh_token_here
```

### Subsequent Runs
Once you've added the tokens to your `.env` file, the app will:
- Use the saved tokens from environment variables
- Automatically refresh the access token when it expires
- Skip the OAuth flow entirely
- Display new tokens if they were refreshed (update your `.env` file if needed)

Simply run:
```bash
npm start
```

### Web Server Mode

The application includes a **Hono-based web server** with BullMQ job queue processing:

```bash
npm run server
```

Available endpoints:
- `GET /` - Health check, status, and API information
- `GET /auth` - Redirect to Oura authentication URL
- `GET /callback` - OAuth callback endpoint
- `POST /sync` - Manual sync trigger (adds job to queue)
- `GET /admin/queues` - Bull Board dashboard for job monitoring

#### Docker Deployment
The Docker container runs the web server with BullMQ worker:

```bash
docker compose up -d
```

This starts:
- PostgreSQL database for token persistence
- Redis for BullMQ job queue
- Web server with integrated worker on port 5555

Then access:
- Health & Status: http://localhost:5555/
- Auth: http://localhost:5555/auth
- Job Dashboard: http://localhost:5555/admin/queues

### Check Token Status
To verify your authentication status:
```bash
npm run check-token
```

This will show:
- Whether tokens are saved
- Token expiration status
- Time until expiration
- Next steps based on token state

### Comprehensive Token Verification
For detailed token diagnostics and API testing:
```bash
npm run verify
```

This performs:
- Token file validation
- Expiration date verification
- Live API access test
- Refresh token availability check
- Environment configuration check

### Clean Up Sleep Entries
To remove ALL sleep entries from Clockify (useful for starting fresh):
```bash
npm run cleanup
```

⚠️ **WARNING**: This will delete ALL sleep entries from Clockify!
- Shows a summary of entries to be deleted
- Waits 10 seconds for confirmation (press Ctrl+C to cancel)
- Deletes all entries with progress tracking
- After cleanup, you can run the sync again for a fresh import

## How it Works

1. **OAuth2 Authentication**: Authenticates with Oura via OAuth2
2. **Clockify Initialization**: Connects to Clockify and identifies your workspace
3. **Project Setup**: Creates or finds a "Sleep" project for organizing entries
4. **Data Fetch**: Retrieves ALL historical sleep data from Oura
5. **Duplicate Check**: Examines existing Clockify entries to avoid duplicates
6. **Sync Process**: Creates time entries for new sleep sessions

Each sleep session is synced as a Clockify time entry with:
- **Start time**: Bedtime from Oura
- **End time**: Wake time from Oura
- **Description**: Includes sleep duration and efficiency percentage
- **Project**: Assigned to the "Sleep" project
- **Billable**: Set to false (non-billable)

## Sync Behavior

### First Run:
- Creates a "Sleep" project in Clockify (if it doesn't exist)
- Syncs ALL available sleep sessions from your Oura history
- Creates time entries for each sleep session

### Subsequent Runs:
- Uses existing "Sleep" project
- Checks for existing entries using unique Oura IDs
- Only syncs new sessions not already in Clockify
- Reports number of synced vs skipped sessions

### Example Time Entry Description:
```
🛌 Sleep - 7h 45m (92% efficiency) [Oura:2024-01-15_22:30]
```

## Scheduling Automatic Syncs

The app uses **BullMQ** with Redis for reliable job scheduling and processing.

### Configuration

Set the sync schedule using the `SYNC_SCHEDULE` environment variable:

```bash
# In your .env file
SYNC_SCHEDULE=0 * * * *  # Every hour (default)
```

Common cron patterns:
- `* * * * *` - Every minute (testing)
- `0 * * * *` - Every hour
- `0 */6 * * *` - Every 6 hours
- `0 0 * * *` - Daily at midnight
- `0 6 * * *` - Daily at 6 AM

### Running the Scheduler

The server mode automatically starts the BullMQ worker and sets up scheduled jobs:

```bash
npm run server
```

This will:
- Start the BullMQ worker
- Set up a repeatable job based on `SYNC_SCHEDULE`
- Run an initial sync immediately
- Process jobs as they are added to the queue

### Monitoring Jobs

Access the Bull Board dashboard to monitor your sync jobs:

```
http://localhost:5555/admin/queues
```

The dashboard shows:
- Active, completed, and failed jobs
- Job details and execution logs
- Queue statistics
- Ability to retry failed jobs manually

### Token Management
- Tokens are stored in your `.env` file as `OURA_ACCESS_TOKEN` and `OURA_REFRESH_TOKEN`
- Access tokens are automatically refreshed when expired using the refresh token
- When tokens are refreshed, the new values are displayed in the console
- **Important:** Tokens are only persisted in your `.env` file. Refreshed tokens shown in console must be manually copied to `.env`, or they will be lost on the next run.
- If refresh fails, you'll need to run `npm start` again to re-authenticate

### Token Lifecycle
1. **Initial Authentication**: `npm start` performs OAuth flow and displays tokens
2. **Save Tokens**: Copy the tokens to your `.env` file for persistence
3. **Auto-Refresh**: When the access token expires, the app uses the refresh token to get a new one
4. **Update .env**: After refresh, new tokens are displayed - update your `.env` file
5. **Monitoring**: The app will log token refresh events and display new tokens

## Troubleshooting

- **Environment validation failed**: Check that ALL required variables are set in your `.env` file. The error message will show exactly which variables are missing or invalid.
- **401 Unauthorized (Oura)**: Verify your OAuth2 credentials are correct
- **401 Unauthorized (Clockify)**: Check your Clockify API token is valid
- **Connection refused**: Ensure port 3000 is available for OAuth2 callback
- **No tokens found**: Run `npm start` first to authenticate and save tokens
- **Failed to refresh token**: Your refresh token may have expired, run `npm start` to re-authenticate
- **Scheduler not running**: Check status with `npm run daemon status`
- **Sync errors**: View logs with `npm run daemon logs` or `npm run verify` to check token status
- **No workspaces found**: Ensure your Clockify account has at least one workspace
- **Failed to create time entry**: Check Clockify API limits or time entry conflicts

## Notes

- The sync uses the first available Clockify workspace
- All sleep entries are automatically assigned to a "Sleep" project
- Sleep sessions include naps and any sleep periods tracked by Oura
- Time entries are created with UTC timestamps from Oura
- The unique ID format is `[Oura:{date}_{HH:MM}]` for simpler descriptions
- API calls include a 500ms delay to prevent rate limiting
- If rate limits are hit, the sync will automatically wait 2 seconds before retrying 

## Project Structure

```
oura-clockify-sync/
├── docs/                 # Documentation
│   ├── README.md         # Documentation index
│   ├── QUICKSTART.md     # Quick start guide
│   └── ENVIRONMENT.md    # Environment configuration guide
├── src/
│   ├── config/           # Configuration
│   │   ├── env.ts        # Environment validation
│   │   └── redis.ts      # Redis connection
│   ├── services/         # API service classes
│   │   ├── clockify-service.ts
│   │   ├── oura-service.ts
│   │   └── sync-service.ts
│   ├── queues/           # BullMQ queue definitions
│   │   └── sync-queue.ts
│   ├── workers/          # BullMQ workers
│   │   └── sync-worker.ts
│   ├── scripts/          # Executable scripts
│   │   ├── index.ts      # Initial auth & sync
│   │   ├── scheduler.ts  # Worker-only mode
│   │   └── sync.ts       # Sync wrapper
│   ├── db/               # Database
│   │   ├── schema.ts     # Drizzle schema
│   │   └── migrate.ts    # Migration runner
│   └── server.ts         # Hono web server
├── docker-compose.yml    # Docker services
├── Dockerfile            # Container image
├── package.json
├── env.example          # Environment template
└── README.md
```

The codebase follows a clean architecture pattern with:
- **Config**: Environment validation and Redis connection
- **Services**: Encapsulate API interactions (Oura, Clockify, Sync)
- **Queues**: BullMQ queue definitions for job management
- **Workers**: Job processors for background tasks
- **Server**: Web API with Bull Board dashboard
- **Database**: PostgreSQL with Drizzle ORM for token persistence