export interface TokenStorage {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp when token expires
}

export interface OuraTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}
