import * as fs from 'node:fs';
import { URLSearchParams } from 'node:url';
import { getEnvironment } from '../config/env';
import type { OuraTokenResponse, TokenStorage } from '../types/auth';

/**
 * Load tokens from storage file
 */
export function loadTokens(): TokenStorage | null {
  const env = getEnvironment();

  try {
    if (fs.existsSync(env.TOKEN_FILE)) {
      const data = fs.readFileSync(env.TOKEN_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load tokens:', error);
  }
  return null;
}

/**
 * Save tokens to storage file
 */
export function saveTokens(tokens: TokenStorage): void {
  const env = getEnvironment();

  try {
    fs.writeFileSync(env.TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf8');
    console.log('✅ Tokens saved to', env.TOKEN_FILE);
  } catch (error) {
    console.error('Failed to save tokens:', error);
    throw error;
  }
}

/**
 * Refresh Oura access token using refresh token
 */
export async function refreshOuraToken(refreshToken: string): Promise<TokenStorage> {
  console.log('🔄 Refreshing Oura access token...');

  const env = getEnvironment();

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: env.OURA_CLIENT_ID,
    client_secret: env.OURA_CLIENT_SECRET,
  });

  const response = await fetch(`${env.OURA_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `Failed to refresh token: ${response.statusText} - ${JSON.stringify(errorData)}`
    );
  }

  const tokenData = (await response.json()) as OuraTokenResponse;

  // Calculate expiration time (expires_in is in seconds)
  const expiresAt = Date.now() + tokenData.expires_in * 1000 - 60 * 1000; // Subtract 1 minute for safety

  return {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || refreshToken, // Use new refresh token if provided, otherwise keep the old one
    expires_at: expiresAt,
  };
}

/**
 * Get a valid access token (refresh if needed)
 */
export async function getValidToken(): Promise<string> {
  const tokens = loadTokens();

  if (!tokens) {
    throw new Error(
      'No tokens found. Please run the initial authentication first using: npm start'
    );
  }

  // Check if token is expired or about to expire
  if (Date.now() >= tokens.expires_at) {
    console.log('⏰ Access token expired, refreshing...');
    const newTokens = await refreshOuraToken(tokens.refresh_token);
    saveTokens(newTokens);
    return newTokens.access_token;
  }

  return tokens.access_token;
}
