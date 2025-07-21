import * as crypto from 'node:crypto';
import { URLSearchParams } from 'node:url';
import { getEnvironment } from '../config/env';
import type { OuraTokenResponse } from '../types/auth';
import type { SleepDataResponse } from '../types/sleep';

interface OuraState {
  accessToken: string | null;
  env: ReturnType<typeof getEnvironment>;
}

export function createOuraService() {
  const state: OuraState = {
    accessToken: null,
    env: getEnvironment(),
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
      return tokenData;
    } catch (error) {
      console.error('Failed to exchange code for token:', error);
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

    const sleepDataResponse = await fetch(
      `${state.env.OURA_API_BASE}/v2/usercollection/sleep?${sleepParams}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

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

  return {
    generateAuthUrl,
    exchangeCodeForToken,
    getSleepData,
    getUserInfo,
    setAccessToken,
  };
}
