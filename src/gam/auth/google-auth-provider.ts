import { GoogleAuth } from 'google-auth-library';

import type { AppConfig } from '../../config/env.js';
import type { GamAuthProvider } from './auth-provider.js';

const AD_MANAGER_SCOPE = 'https://www.googleapis.com/auth/admanager';
const AD_MANAGER_READ_ONLY_SCOPE = 'https://www.googleapis.com/auth/admanager.readonly';

export class GoogleGamAuthProvider implements GamAuthProvider {
  private readonly auth: GoogleAuth;

  constructor(config: AppConfig) {
    this.auth = new GoogleAuth({
      scopes: [config.gam.readOnly ? AD_MANAGER_READ_ONLY_SCOPE : AD_MANAGER_SCOPE],
      ...(config.google.applicationCredentials
        ? { keyFilename: config.google.applicationCredentials }
        : {}),
    });
  }

  async authenticate(): Promise<void> {
    await this.getAccessToken();
  }

  async getAccessToken(): Promise<string> {
    const client = await this.auth.getClient();
    const token = await client.getAccessToken();
    const value = typeof token === 'string' ? token : token.token;
    if (!value) throw new Error('Google authentication did not return an access token.');
    return value;
  }
}
