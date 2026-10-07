import type { ApiClient } from './types';
import { MockApiClient } from './mock-client';
import { HttpApiClient } from './http-client';

/**
 * Factory del client API. Default: mock in-memory (la UI funziona senza
 * backend). Impostare NEXT_PUBLIC_API_MODE=real e NEXT_PUBLIC_API_URL per usare
 * l'API vera (apps/api).
 */
let instance: ApiClient | null = null;

export function getApiClient(): ApiClient {
  if (instance) return instance;
  const mode = process.env.NEXT_PUBLIC_API_MODE ?? 'mock';
  if (mode === 'real') {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
    instance = new HttpApiClient(baseUrl);
  } else {
    instance = new MockApiClient();
  }
  return instance;
}
