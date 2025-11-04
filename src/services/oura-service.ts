import * as crypto from 'node:crypto';
import { URLSearchParams } from 'node:url';
import { getEnvironment } from '../config/env';
import type { OuraTokenResponse } from '../types/auth';
import type { SleepDataResponse } from '../types/sleep';

interface OuraState {
  accessToken: string | null;
  refreshToken: string | null;
  env: ReturnType<typeof getEnvironment>;
}

export function createOuraService() {
  const env = getEnvironment();
  const state: OuraState = {
    accessToken: env.OURA_ACCESS_TOKEN || null,
    refreshToken: env.OURA_REFRESH_TOKEN || null,
    env,
  };

  /**
   * Generate OAuth2 authorization URL
   */
  const generateAuthUrl = (authState?: string): string => {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: state.env.OURA_CLIENT_ID,
      redirect_uri: state.env.REDIRECT_URI,
      scope: state.env.OAUTH_SCOPES,
      state: authState || crypto.randomBytes(16).toString('hex'),
    });

    return `${state.env.OURA_AUTH_BASE}/oauth/authorize?${params.toString()}`;
  };

  /**
   * Exchange authorization code for access token
   */
  const exchangeCodeForToken = async (code: string): Promise<OuraTokenResponse> => {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: state.env.OURA_CLIENT_ID,
      client_secret: state.env.OURA_CLIENT_SECRET,
      redirect_uri: state.env.REDIRECT_URI,
    });

    try {
      const response = await fetch(`${state.env.OURA_API_BASE}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw {
          status: response.status,
          statusText: response.statusText,
          data: errorData,
        };
      }

      const tokenData = (await response.json()) as OuraTokenResponse;
      state.accessToken = tokenData.access_token;
      if (tokenData.refresh_token) {
        state.refreshToken = tokenData.refresh_token;
      }
      return tokenData;
    } catch (error) {
      console.error('Failed to exchange code for token:', error);
      throw error;
    }
  };

  /**
   * Refresh the access token using the refresh token
   */
  const refreshAccessToken = async (): Promise<OuraTokenResponse> => {
    if (!state.refreshToken) {
      throw new Error('No refresh token available. Please re-authenticate.');
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: state.refreshToken,
      client_id: state.env.OURA_CLIENT_ID,
      client_secret: state.env.OURA_CLIENT_SECRET,
    });

    try {
      const response = await fetch(`${state.env.OURA_API_BASE}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw {
          status: response.status,
          statusText: response.statusText,
          data: errorData,
        };
      }

      const tokenData = (await response.json()) as OuraTokenResponse;
      state.accessToken = tokenData.access_token;
      if (tokenData.refresh_token) {
        state.refreshToken = tokenData.refresh_token;
      }

      console.log('✅ Successfully refreshed access token');
      console.log('🔑 New tokens:');
      console.log('\nOURA_ACCESS_TOKEN=');
      console.log(tokenData.access_token);
      if (tokenData.refresh_token) {
        console.log('\nOURA_REFRESH_TOKEN=');
        console.log(tokenData.refresh_token);
      }
      console.log('');

      return tokenData;
    } catch (error) {
      console.error('Failed to refresh access token:', error);
      throw error;
    }
  };

  /**
   * Fetch sleep data from Oura API
   */
  const getSleepData = async (
    startDate: string,
    endDate: string,
    accessToken?: string
  ): Promise<SleepDataResponse> => {
    const token = accessToken || state.accessToken;

    if (!token) {
      throw new Error('No access token available. Please authenticate first.');
    }

    const sleepParams = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
    });

    let sleepDataResponse = await fetch(
      `${state.env.OURA_API_BASE}/v2/usercollection/sleep?${sleepParams}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    // If we get a 401, try refreshing the token
    if (sleepDataResponse.status === 401 && state.refreshToken) {
      console.log('🔄 Access token expired, refreshing...');
      await refreshAccessToken();

      // Retry the request with the new token
      sleepDataResponse = await fetch(
        `${state.env.OURA_API_BASE}/v2/usercollection/sleep?${sleepParams}`,
        {
          headers: {
            Authorization: `Bearer ${state.accessToken}`,
          },
        }
      );
    }

    if (!sleepDataResponse.ok) {
      const errorData = await sleepDataResponse.json().catch(() => ({}));
      throw {
        status: sleepDataResponse.status,
        statusText: sleepDataResponse.statusText,
        data: errorData,
      };
    }

    return sleepDataResponse.json() as Promise<SleepDataResponse>;
  };

  /**
   * Get user personal information
   */
  const getUserInfo = async (accessToken?: string): Promise<unknown> => {
    const token = accessToken || state.accessToken;

    if (!token) {
      throw new Error('No access token available. Please authenticate first.');
    }

    const response = await fetch(`${state.env.OURA_API_BASE}/v2/usercollection/personal_info`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.statusText}`);
    }

    return response.json();
  };

  /**
   * Set access token directly
   */
  const setAccessToken = (token: string): void => {
    state.accessToken = token;
  };

  /**
   * Check if the service has a valid access token
   */
  const hasAccessToken = (): boolean => {
    return !!state.accessToken;
  };

  return {
    generateAuthUrl,
    exchangeCodeForToken,
    refreshAccessToken,
    getSleepData,
    getUserInfo,
    setAccessToken,
    hasAccessToken,
  };
}
