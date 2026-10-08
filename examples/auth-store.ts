/**
 * A minimal token store. Access tokens live in memory; the refresh token is sent as an
 * httpOnly cookie by the auth server, so the refresh call only needs `credentials: 'include'`.
 */
import { z } from 'zod';

import { createRepository, createRoute, fetchAdapter } from '../src/index.js';

const authApi = createRepository({
  baseUrl: 'https://auth.example.com',
  adapter: fetchAdapter({ init: { credentials: 'include' } }),
  // No refresh middleware here: refreshing must not try to refresh itself.
})
  .mergeAll({
    refresh: createRoute.post('/token/refresh', {
      response: z.object({ accessToken: z.string(), expiresIn: z.number() }),
      retry: false,
    }),
    signOut: createRoute.post('/sign-out', { responseType: 'none' }),
  })
  .build();

let accessToken: string | null = null;
let expiresAt = 0;
const listeners = new Set<() => void>();

export const auth = {
  getAccessToken(): string | null {
    return accessToken;
  },

  /** `true` when the token is missing or expires within the next 30 seconds. */
  isExpiringSoon(): boolean {
    return accessToken === null || Date.now() > expiresAt - 30_000;
  },

  setSession(token: string, expiresInSeconds: number): void {
    accessToken = token;
    expiresAt = Date.now() + expiresInSeconds * 1000;
    listeners.forEach((listener) => {
      listener();
    });
  },

  /** Ask the auth server for a new access token. Resolves `null` when the session is gone. */
  async refresh(): Promise<string | null> {
    const { data, error } = await authApi.refresh();
    if (error) {
      auth.clear();
      return null;
    }
    auth.setSession(data.accessToken, data.expiresIn);
    return data.accessToken;
  },

  async signOut(): Promise<void> {
    await authApi.signOut();
    auth.clear();
  },

  clear(): void {
    accessToken = null;
    expiresAt = 0;
    listeners.forEach((listener) => {
      listener();
    });
  },

  /** Subscribe to session changes (used by `useSyncExternalStore` in React). */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
