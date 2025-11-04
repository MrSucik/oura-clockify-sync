# Environment Configuration

## Overview

The Oura Clockify Sync uses **comprehensive environment validation** with Zod. All environment variables are **required** with no defaults. The application validates the entire environment at startup and exits with detailed error messages if any variables are missing or invalid.

## Key Features

- ✅ **Zero defaults** - All variables must be explicitly set
- ✅ **Type validation** - Numbers, URLs, and enums are properly validated  
- ✅ **Detailed errors** - Clear messages showing exactly what's wrong
- ✅ **Centralized** - Single validation point used by all scripts
- ✅ **Path validation** - Ensures directories can be created and written to
- ✅ **Cached** - Environment validated once and reused across the application

## Setup Process

### 1. Copy Example File
```bash
cp env.example .env
```

### 2. Replace ALL Placeholder Values
The example file contains placeholder values like `your_client_id_here`. You **must** replace ALL of these with actual values:

```bash
# ❌ This will fail validation
OURA_CLIENT_ID=your_client_id_here

# ✅ This will pass validation  
OURA_CLIENT_ID=ac1234567890abcdef
```

### 3. Set Required Credentials

#### Get Oura OAuth2 Credentials:
1. Go to https://cloud.ouraring.com/oauth/applications
2. Create a new application
3. Set redirect URI to exactly `http://localhost:3000/callback`
4. Note your Client ID and Client Secret

#### Get Clockify API Token:
1. Go to https://app.clockify.me/user/settings
2. Scroll to API section  
3. Generate or copy your API token

## Required Variables

### Authentication
| Variable | Description | Example |
|----------|-------------|---------|
| `OURA_CLIENT_ID` | OAuth2 client ID from Oura | `ac1234567890abcdef` |
| `OURA_CLIENT_SECRET` | OAuth2 client secret from Oura | `def567890abc123456` |
| `CLOCKIFY_API_TOKEN` | Clockify API token | `XYZ789ABC123DEF456` |

### Application Configuration
| Variable | Description | Valid Values |
|----------|-------------|--------------|
| `NODE_ENV` | Environment | `development`, `production`, `test` |
| `SYNC_DAYS` | Days to sync | `1` to `365` |
| `SERVER_PORT` | OAuth callback server port | `1` to `65535` |

### API Endpoints
| Variable | Description | Default Value |
|----------|-------------|---------------|
| `OURA_API_BASE` | Oura API base URL | `https://api.ouraring.com` |
| `OURA_AUTH_BASE` | Oura OAuth base URL | `https://cloud.ouraring.com` |
| `CLOCKIFY_API_BASE` | Clockify API base URL | `https://api.clockify.me/api` |

### OAuth Configuration
| Variable | Description | Default Value |
|----------|-------------|---------------|
| `REDIRECT_URI` | OAuth redirect URI | `http://localhost:3000/callback` |
| `OAUTH_SCOPES` | OAuth scopes | `daily` |

### Performance Tuning
| Variable | Description | Range | Default |
|----------|-------------|-------|---------|
| `CLOCKIFY_API_DELAY` | Delay between API calls (ms) | `0` to `10000` | `50` |

### Project Configuration
| Variable | Description | Default Value |
|----------|-------------|---------------|
| `SLEEP_PROJECT_NAME` | Clockify project name | `Sleep` |

## Validation Behavior

### Startup Validation
Every script validates the environment on startup:
```typescript
// All scripts start with this
const env = validateEnvironment();
```

### Error Messages
If validation fails, you'll see detailed error messages:

```
❌ Environment validation failed:

Missing required variables:
  - NODE_ENV: NODE_ENV must be one of: development, production, test
  - SYNC_DAYS: Required
  
Invalid variable values:
  - SERVER_PORT: SERVER_PORT must be a valid port number (1-65535)
  - OURA_API_BASE: OURA_API_BASE must be a valid URL
```

### Path Validation
The system also validates that:
- Log directory exists or can be created
- Token file directory exists or can be created  
- File system has write permissions

## Development vs Production

### Development Setup
```bash
NODE_ENV=development
SYNC_DAYS=1
```

### Production Setup
```bash
NODE_ENV=production
SYNC_DAYS=2
```

## Troubleshooting

### Common Issues

1. **Missing .env file**
   - Copy `env.example` to `.env`
   - Replace all placeholder values

2. **Placeholder values not replaced**
   - Search for `your_*_here` patterns
   - Replace with actual credentials

3. **Invalid URLs**
   - Ensure URLs start with `http://` or `https://`
   - No trailing slashes

4. **Invalid numbers**
   - `SYNC_DAYS` must be 1-365
   - `SERVER_PORT` must be 1-65535
   - `CLOCKIFY_API_DELAY` must be 0-10000

5. **Invalid enums**
   - `NODE_ENV`: development, production, or test

### Testing Your Configuration

Run any script to test your environment setup:
```bash
npx tsx verify-tokens.ts
```

If the environment is valid, the script will start. If not, you'll get detailed error messages.

## Architecture

The environment validation is centralized in `src/config/env.ts`:

- **Single source of truth** for all environment requirements
- **Zod schema validation** with custom error messages  
- **Type-safe exports** for use across the application
- **Caching** to avoid re-validation on subsequent imports
- **Path validation** to ensure filesystem access

All scripts import and use this centralized validation, ensuring consistency across the entire application. 