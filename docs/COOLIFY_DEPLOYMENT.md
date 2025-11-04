# Coolify Deployment Guide

This guide explains how to deploy the Oura Clockify Sync to Coolify.

## Prerequisites

1. A Coolify instance set up and running
2. Oura API credentials (Client ID and Client Secret)
3. Clockify API token and workspace/project IDs
4. Initial authentication completed locally (to get tokens.json)

## Deployment Steps

### 1. Initial Authentication

Before deploying, you need to authenticate with Oura locally:

```bash
# Clone the repository
git clone <your-repo-url>
cd oura-clockify-sync

# Install dependencies
npm install

# Set up environment variables
cp env.example .env
# Edit .env with your credentials

# Run initial authentication
npm start
# Follow the OAuth flow in your browser
```

This will create a `tokens.json` file that you'll need for deployment.

### 2. Create New Application in Coolify

1. Log in to your Coolify dashboard
2. Navigate to your project/environment
3. Click "New Resource" → "Application"
4. Choose "Docker Image" or "GitHub Repository" based on your preference

### 3. Configure Application

#### If using GitHub Repository:
- Repository URL: `<your-repo-url>`
- Branch: `main` (or your preferred branch)
- Build Pack: `Dockerfile`

#### If using Docker Image:
- Build and push your image first:
  ```bash
  docker build -t your-registry/oura-clockify-sync:latest .
  docker push your-registry/oura-clockify-sync:latest
  ```
- Image: `your-registry/oura-clockify-sync:latest`

### 4. Environment Variables

Add the following environment variables in Coolify:

```env
# Required - Oura API
OURA_CLIENT_ID=your_oura_client_id
OURA_CLIENT_SECRET=your_oura_client_secret

# Required - Oura OAuth Tokens
# Get these by running "npm start" locally first
OURA_ACCESS_TOKEN=your_access_token_from_tokens_json
OURA_REFRESH_TOKEN=your_refresh_token_from_tokens_json
OURA_TOKEN_EXPIRES_AT=your_expires_at_from_tokens_json

# Required - Clockify API
CLOCKIFY_API_TOKEN=your_clockify_api_token

# Optional - Override defaults
PORT=8080
SYNC_SCHEDULE=0 */6 * * *
SYNC_DAYS=1

# Optional - API delays (milliseconds)
OURA_API_DELAY=1100
CLOCKIFY_API_DELAY=200
```

### 5. Persistent Storage (Optional)

Add a persistent volume for logs if you want to persist them:

1. In Coolify, go to your application settings
2. Add persistent storage:
   - Mount path: `/app/logs`
   - Size: 100MB
   - Purpose: Store application logs

### 6. Health Check Configuration

Coolify should automatically detect the health check from the Dockerfile. If not, configure:

- Health Check URL: `/health/liveness`
- Port: `8080`
- Interval: `30s`
- Timeout: `10s`
- Retries: `3`

### 7. Deploy

1. Click "Deploy" in Coolify
2. Monitor the deployment logs
3. Once deployed, check the health endpoint: `https://your-app.coolify.domain/health`

## Available Endpoints

- `/health` - Detailed health status
- `/health/liveness` - Simple liveness check
- `/health/readiness` - Readiness check (validates tokens)
- `/status` - Application status and statistics

## Monitoring

The application provides several monitoring endpoints:

```bash
# Check health
curl https://your-app.coolify.domain/health

# Check status
curl https://your-app.coolify.domain/status
```

## Troubleshooting

### Application Not Starting
- Check logs in Coolify
- Verify all required environment variables are set
- Ensure tokens.json is properly mounted

### Sync Not Working
- Check `/health` endpoint for token validity
- Verify Clockify workspace/project IDs are correct
- Check application logs for specific errors

### Re-authentication Required
If tokens expire:
1. Run authentication locally again
2. Update the tokens.json in persistent storage
3. Restart the application in Coolify

## Sync Schedule

The default sync schedule is every 6 hours. You can customize this using cron syntax:

- `0 * * * *` - Every hour
- `0 */6 * * *` - Every 6 hours (default)
- `0 0 * * *` - Daily at midnight
- `0 9,21 * * *` - Twice daily at 9 AM and 9 PM

## Security Notes

- Never commit tokens.json to version control
- Use Coolify's secret management for sensitive environment variables
- Regularly rotate your API tokens
- Monitor the application logs for any authentication issues