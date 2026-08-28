export interface GamAuthProvider {
  authenticate(): Promise<void>;
  getAccessToken(): Promise<string>;
}
