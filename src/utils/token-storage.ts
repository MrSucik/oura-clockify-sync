import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { tokens } from '../db/schema';
import type { OuraTokenResponse } from '../types/auth';

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: string;
  scope?: string;
}

const TOKEN_FILE = path.join(process.cwd(), '.oura-tokens.json');
const USE_DATABASE = !!process.env.DATABASE_URL;

export async function saveTokens(tokenResponse: OuraTokenResponse): Promise<void> {
  const tokenData: TokenData = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token || '',
    expires_at: Date.now() + tokenResponse.expires_in * 1000,
    token_type: tokenResponse.token_type,
    scope: tokenResponse.scope,
  };

  if (USE_DATABASE) {
    try {
      const db = getDb();
      await db
        .insert(tokens)
        .values({
          provider: 'oura',
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt: tokenData.expires_at,
          tokenType: tokenData.token_type,
          scope: tokenData.scope || null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: tokens.provider,
          set: {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: tokenData.expires_at,
            tokenType: tokenData.token_type,
            scope: tokenData.scope || null,
            updatedAt: new Date(),
          },
        });
      console.log('💾 Tokens saved to database');
    } catch (error) {
      console.error('Failed to save tokens to database:', error);
      saveToFile(tokenData);
    }
  } else {
    saveToFile(tokenData);
  }
}

function saveToFile(tokenData: TokenData): void {
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2), 'utf-8');
    console.log('💾 Tokens saved to file');
  } catch (error) {
    console.error('Failed to save tokens to file:', error);
  }
}

export async function loadTokens(): Promise<TokenData | null> {
  if (USE_DATABASE) {
    try {
      const db = getDb();
      const result = await db.select().from(tokens).where(eq(tokens.provider, 'oura')).limit(1);

      if (result.length === 0) {
        return loadFromFile();
      }

      const token = result[0];
      return {
        access_token: token.accessToken,
        refresh_token: token.refreshToken,
        expires_at: token.expiresAt,
        token_type: token.tokenType,
        scope: token.scope || undefined,
      };
    } catch (error) {
      console.error('Failed to load tokens from database:', error);
      return loadFromFile();
    }
  }

  return loadFromFile();
}

function loadFromFile(): TokenData | null {
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

export async function clearTokens(): Promise<void> {
  if (USE_DATABASE) {
    try {
      const db = getDb();
      await db.delete(tokens).where(eq(tokens.provider, 'oura'));
      console.log('🗑️  Tokens removed from database');
    } catch (error) {
      console.error('Failed to clear tokens from database:', error);
    }
  }

  try {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
      console.log('🗑️  Token file removed');
    }
  } catch (error) {
    console.error('Failed to clear token file:', error);
  }
}

export async function hasValidTokens(): Promise<boolean> {
  const tokenData = await loadTokens();
  if (!tokenData) {
    return false;
  }

  if (Date.now() >= tokenData.expires_at) {
    console.log('⏰ Tokens expired');
    return false;
  }

  return true;
}
