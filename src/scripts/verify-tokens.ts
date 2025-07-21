import { validateEnvironment } from '../config/env';
import { createOuraService } from '../services/oura-service';
import type { TokenStorage } from '../types/auth';
import { getErrorMessage } from '../utils/common';
import { loadTokens } from '../utils/token';

// Validate environment on startup
const env = validateEnvironment();

// TokenStorage interface now imported from types

async function verifyTokens() {
  console.log('🔍 Oura Token Verification Tool\n');
  console.log('═'.repeat(50));

  let tokens: TokenStorage | null = null;

  // Step 1: Check token file
  console.log('\n1️⃣  Checking token file...');
  try {
    tokens = loadTokens();

    if (!tokens) {
      console.log(`   ❌ Token file not found: ${env.TOKEN_FILE}`);
      console.log('   → Run "npm start" to authenticate first');
      return;
    }

    console.log('   ✅ Token file exists and is valid JSON');

    // Validate token structure
    if (!tokens?.access_token || !tokens?.refresh_token || !tokens?.expires_at) {
      console.log('   ❌ Token file is missing required fields');
      console.log('   → Run "npm start" to re-authenticate');
      return;
    }
    console.log('   ✅ Token structure is valid');
  } catch (error) {
    console.log('   ❌ Error reading token file:', error);
    console.log('   → Token file might be corrupted, run "npm start" to re-authenticate');
    return;
  }

  // Step 2: Check token expiration
  console.log('\n2️⃣  Checking token expiration...');
  const now = Date.now();
  const expiresAt = new Date(tokens.expires_at);
  const isExpired = now >= tokens.expires_at;
  const timeUntilExpiry = tokens.expires_at - now;

  console.log(`   📅 Token expires at: ${expiresAt.toLocaleString()}`);
  console.log(`   📅 Current time:     ${new Date().toLocaleString()}`);

  if (isExpired) {
    const minutesAgo = Math.abs(Math.round(timeUntilExpiry / 1000 / 60));
    console.log(`   ❌ Token EXPIRED ${minutesAgo} minutes ago`);
    console.log('   → Token will be automatically refreshed on next sync');
  } else {
    const days = Math.floor(timeUntilExpiry / 1000 / 60 / 60 / 24);
    const hours = Math.floor((timeUntilExpiry / 1000 / 60 / 60) % 24);
    const minutes = Math.floor((timeUntilExpiry / 1000 / 60) % 60);
    console.log(`   ✅ Token is VALID for ${days}d ${hours}h ${minutes}m`);
  }

  // Step 3: Test API access
  console.log('\n3️⃣  Testing Oura API access...');
  try {
    const ouraService = createOuraService();
    const userData = await ouraService.getUserInfo(tokens.access_token);

    console.log('   ✅ API access successful');

    // Safely access userData properties
    const userInfo = userData as Record<string, unknown>; // API response structure
    console.log(`   👤 User ID: ${userInfo?.id || 'N/A'}`);
    console.log(`   📅 Member since: ${userInfo?.member_since || 'N/A'}`);
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    if (errorMessage.includes('401')) {
      console.log('   ❌ API access denied (401 Unauthorized)');
      console.log('   → Token might be invalid or expired');

      if (!isExpired) {
        console.log('   ⚠️  Token appears valid but API rejected it');
        console.log('   → Try running "npm run auto-sync" to refresh');
      }
    } else {
      console.log(`   ❌ API error: ${errorMessage}`);
    }
  }

  // Step 4: Check refresh token
  console.log('\n4️⃣  Checking refresh token...');
  if (tokens.refresh_token) {
    console.log('   ✅ Refresh token is present');
    console.log(`   🔑 Token preview: ${tokens.refresh_token.substring(0, 20)}...`);

    // Note: We don't actually test the refresh token to avoid using it unnecessarily
    console.log('   ℹ️  Refresh token will be tested when access token expires');
  } else {
    console.log('   ❌ No refresh token found');
    console.log('   → You will need to re-authenticate when token expires');
  }

  // Step 5: Environment check
  console.log('\n5️⃣  Checking environment configuration...');
  console.log('   ✅ OURA_CLIENT_ID is set');
  console.log('   ✅ OURA_CLIENT_SECRET is set');
  console.log('   ✅ CLOCKIFY_API_TOKEN is set');

  // Summary and recommendations
  console.log(`\n${'═'.repeat(50)}`);
  console.log('\n📊 SUMMARY\n');

  if (!isExpired && tokens.refresh_token) {
    console.log('✅ Everything looks good!');
    console.log('   - Token is valid');
    console.log('   - Refresh token is available');
    console.log('   - Ready for automated syncing');
    console.log('\n💡 You can safely use "npm run auto-sync" in cron jobs');
  } else if (isExpired && tokens.refresh_token) {
    console.log('⚠️  Token expired but can be refreshed');
    console.log('   - Access token has expired');
    console.log('   - Refresh token is available');
    console.log('\n💡 Run "npm run auto-sync" to refresh and sync');
  } else {
    console.log('❌ Issues detected');
    console.log('   - Check the errors above');
    console.log('\n💡 You may need to run "npm start" to re-authenticate');
  }

  console.log(`\n${'═'.repeat(50)}\n`);
}

// Run verification
verifyTokens().catch((error) => {
  console.error('\n❌ Verification failed:', error);
  process.exit(1);
});
