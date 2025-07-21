import { validateEnvironment } from '../config/env';
import { loadTokens } from '../utils/token';

// Validate environment on startup
validateEnvironment();

function checkTokenStatus() {
  console.log('🔍 Checking Oura token status...\n');

  try {
    const tokens = loadTokens();

    if (!tokens) {
      console.log('❌ No token file found.');
      console.log('   Run "npm start" to authenticate first.\n');
      return;
    }

    console.log('✅ Token file found: oura-tokens.json');
    console.log('');

    // Check token details
    console.log('📊 Token Information:');
    console.log(`   Access Token: ${tokens.access_token.substring(0, 20)}...`);
    console.log(
      `   Refresh Token: ${tokens.refresh_token ? `${tokens.refresh_token.substring(0, 20)}...` : 'Not available'}`
    );

    // Check expiration
    const now = Date.now();
    const expiresAt = new Date(tokens.expires_at);
    const isExpired = now >= tokens.expires_at;
    const timeUntilExpiry = tokens.expires_at - now;

    console.log('');
    console.log('⏰ Expiration Status:');
    console.log(`   Expires at: ${expiresAt.toLocaleString()}`);

    if (isExpired) {
      console.log(
        `   Status: ❌ EXPIRED (${Math.abs(Math.round(timeUntilExpiry / 1000 / 60))} minutes ago)`
      );
      console.log('   The auto-sync script will automatically refresh the token when run.');
    } else {
      const hoursLeft = Math.floor(timeUntilExpiry / 1000 / 60 / 60);
      const minutesLeft = Math.floor((timeUntilExpiry / 1000 / 60) % 60);
      console.log(`   Status: ✅ VALID (expires in ${hoursLeft}h ${minutesLeft}m)`);
    }

    console.log('');
    console.log('💡 Next Steps:');
    if (isExpired) {
      console.log('   - Run "npm run auto-sync" to refresh the token and sync');
      console.log('   - Or run "npm start" to re-authenticate manually');
    } else {
      console.log('   - You can run "npm run auto-sync" for automatic sync');
      console.log('   - Token will be automatically refreshed when needed');
    }
    console.log('');
  } catch (error) {
    console.error('❌ Error reading token file:', error);
    console.log('   The token file might be corrupted.');
    console.log('   Run "npm start" to re-authenticate.\n');
  }
}

// Run the check
checkTokenStatus();
