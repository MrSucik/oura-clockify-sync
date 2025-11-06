import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OuraTokenResponse } from '../types/auth';

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: string;
  scope?: string;
}

const TOKEN_FILE = path.join(process.cwd(), '.oura-tokens.json');

export function saveTokens(tokenResponse: OuraTokenResponse): void {
  try {
    const tokenData: TokenData = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token || '',
      expires_at: Date.now() + tokenResponse.expires_in * 1000,
      token_type: tokenResponse.token_type,
      scope: tokenResponse.scope,
    };

    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2), 'utf-8');
    console.log('💾 Tokens saved to file');
  } catch (error) {
    console.error('Failed to save tokens to file:', error);
  }
}

export function loadTokens(): TokenData | null {
  try {
    if (!fs.existsSync(TOKEN_FILE)) {
      return null;
    }

    const data = fs.readFileSync(TOKEN_FILE, 'utf-8');
    const tokenData = JSON.parse(data) as TokenData;

    if (!tokenData.access_token || !tokenData.refresh_token) {
      console.warn('⚠️  Invalid token data in file');
      return null;
    }

    return tokenData;
  } catch (error) {
    console.error('Failed to load tokens from file:', error);
    return null;
  }
}

export function clearTokens(): void {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
      console.log('🗑️  Token file removed');
    }
  } catch (error) {
    console.error('Failed to clear token file:', error);
  }
}

export function hasValidTokens(): boolean {
  const tokens = loadTokens();
  if (!tokens) {
    return false;
  }

  if (Date.now() >= tokens.expires_at) {
    console.log('⏰ Tokens expired');
    return false;
  }

  return true;
}
