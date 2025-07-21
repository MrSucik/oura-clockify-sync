// Note: Properties use snake_case to match OAuth token format
export interface TokenStorage {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp when token expires
}

// Note: Properties use snake_case to match Oura OAuth API response format
export interface OuraTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}
