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

export async function saveTokens(tokenResponse: OuraTokenResponse): Promise<void> {
  const tokenData: TokenData = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token || '',
    expires_at: Date.now() + tokenResponse.expires_in * 1000,
    token_type: tokenResponse.token_type,
    scope: tokenResponse.scope,
  };

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
}

export async function loadTokens(): Promise<TokenData | null> {
  const db = getDb();
  const result = await db.select().from(tokens).where(eq(tokens.provider, 'oura')).limit(1);

  if (result.length === 0) {
    return null;
  }

  const token = result[0];
  return {
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expires_at: token.expiresAt,
    token_type: token.tokenType,
    scope: token.scope || undefined,
  };
}

export async function clearTokens(): Promise<void> {
  const db = getDb();
  await db.delete(tokens).where(eq(tokens.provider, 'oura'));
  console.log('🗑️  Tokens removed from database');
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
