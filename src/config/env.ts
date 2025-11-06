import { z } from 'zod';

// Comprehensive environment schema - ALL REQUIRED, NO DEFAULTS
const envSchema = z.object({
  // Oura API Configuration
  OURA_CLIENT_ID: z.string().min(1, 'Oura OAuth2 client ID is required'),
  OURA_CLIENT_SECRET: z.string().min(1, 'Oura OAuth2 client secret is required'),

  // Oura OAuth2 Tokens (optional - if not provided, OAuth flow will be triggered)
  OURA_ACCESS_TOKEN: z.string().optional(),
  OURA_REFRESH_TOKEN: z.string().optional(),

  // Clockify API Configuration
  CLOCKIFY_API_TOKEN: z.string().min(1, 'Clockify API token is required'),

  // Application Configuration
  NODE_ENV: z.enum(['development', 'production', 'test'], {
    errorMap: () => ({ message: 'NODE_ENV must be one of: development, production, test' }),
  }),

  // Sync Configuration
  SYNC_DAYS: z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine((val) => !Number.isNaN(val) && val >= 1 && val <= 365, {
      message: 'SYNC_DAYS must be a number between 1 and 365',
    }),

  // Server Configuration
  SERVER_PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine((val) => !Number.isNaN(val) && val >= 1 && val <= 65535, {
      message: 'SERVER_PORT must be a valid port number (1-65535)',
    }),

  // API Configuration
  OURA_API_BASE: z.string().url('OURA_API_BASE must be a valid URL'),
  OURA_AUTH_BASE: z.string().url('OURA_AUTH_BASE must be a valid URL'),
  CLOCKIFY_API_BASE: z.string().url('CLOCKIFY_API_BASE must be a valid URL'),

  // OAuth Configuration
  REDIRECT_URI: z.string().url('REDIRECT_URI must be a valid URL'),
  OAUTH_SCOPES: z.string().min(1, 'OAUTH_SCOPES is required'),

  // Rate Limiting Configuration
  CLOCKIFY_API_DELAY: z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine((val) => !Number.isNaN(val) && val >= 0 && val <= 10000, {
      message: 'CLOCKIFY_API_DELAY must be a number between 0 and 10000 (milliseconds)',
    }),

  // Project Configuration
  SLEEP_PROJECT_NAME: z.string().min(1, 'SLEEP_PROJECT_NAME is required'),

  // Database Configuration (optional - uses file storage if not provided)
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL must be a valid PostgreSQL connection string')
    .optional(),
});

// Inferred type for the validated environment
export type Environment = z.infer<typeof envSchema>;

// Cached validated environment
let cachedEnv: Environment | null = null;

/**
 * Validates and returns the application environment configuration
 * @param skipDotenv - Skip loading .env file (useful for tests)
 * @returns Validated environment configuration
 * @throws Error if validation fails
 */
export function validateEnvironment(skipDotenv: boolean = false): Environment {
  // Return cached environment if already validated
  if (cachedEnv) {
    return cachedEnv;
  }

  // Load .env file if not skipped
  if (!skipDotenv) {
    try {
      require('dotenv/config');
    } catch (error) {
      console.error('❌ Failed to load .env file:', error);
      process.exit(1);
    }
  }

  try {
    // Validate environment variables
    cachedEnv = envSchema.parse(process.env);

    console.log('✅ Environment validation successful');
    console.log(`   Environment: ${cachedEnv.NODE_ENV}`);
    console.log(`   Sync Days: ${cachedEnv.SYNC_DAYS}`);

    return cachedEnv;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('\n❌ Environment validation failed:\n');

      // Group errors by type for better readability
      const missingVars: string[] = [];
      const invalidVars: string[] = [];

      error.errors.forEach((err) => {
        const field = err.path.join('.');
        if (err.code === 'invalid_type' && err.received === 'undefined') {
          missingVars.push(`  - ${field}: ${err.message}`);
        } else {
          invalidVars.push(`  - ${field}: ${err.message}`);
        }
      });

      if (missingVars.length > 0) {
        console.error('Missing required variables:');
        missingVars.forEach((msg) => console.error(msg));
        console.error('');
      }

      if (invalidVars.length > 0) {
        console.error('Invalid variable values:');
        invalidVars.forEach((msg) => console.error(msg));
        console.error('');
      }

      console.error(
        'Please check your .env file and ensure all required variables are set correctly.'
      );
      console.error('See env.example for the required configuration.\n');

      // Show example .env content
      showExampleEnv();
    } else {
      console.error('❌ Environment validation error:', error);
    }

    process.exit(1);
  }
}

/**
 * Shows an example .env file content
 */
function showExampleEnv(): void {
  console.error('Example .env file:');
  console.error('');
  console.error('# Oura API OAuth2 Configuration');
  console.error('OURA_CLIENT_ID=your_client_id_here');
  console.error('OURA_CLIENT_SECRET=your_client_secret_here');
  console.error('');
  console.error(
    '# Oura OAuth2 Tokens (optional - will be obtained via OAuth flow if not provided)'
  );
  console.error('# OURA_ACCESS_TOKEN=your_access_token_here');
  console.error('# OURA_REFRESH_TOKEN=your_refresh_token_here');
  console.error('');
  console.error('# Clockify API Configuration');
  console.error('CLOCKIFY_API_TOKEN=your_clockify_token_here');
  console.error('');
  console.error('# Application Configuration');
  console.error('NODE_ENV=development');
  console.error('SYNC_DAYS=1');
  console.error('SERVER_PORT=5555');
  console.error('');
  console.error('# API Endpoints');
  console.error('OURA_API_BASE=https://api.ouraring.com');
  console.error('OURA_AUTH_BASE=https://cloud.ouraring.com');
  console.error('CLOCKIFY_API_BASE=https://api.clockify.me/api');
  console.error('');
  console.error('# OAuth Configuration');
  console.error('REDIRECT_URI=http://localhost:5555/callback');
  console.error('OAUTH_SCOPES=daily');
  console.error('');
  console.error('# Performance Configuration');
  console.error('CLOCKIFY_API_DELAY=50');
  console.error('');
  console.error('# Project Configuration');
  console.error('SLEEP_PROJECT_NAME=Sleep');
  console.error('');
}

/**
 * Gets the validated environment (must be called after validateEnvironment)
 */
export function getEnvironment(): Environment {
  if (!cachedEnv) {
    throw new Error('Environment not validated yet. Call validateEnvironment() first.');
  }
  return cachedEnv;
}

/**
 * Resets the cached environment (useful for tests)
 */
export function resetEnvironment(): void {
  cachedEnv = null;
}
