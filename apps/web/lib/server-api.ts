import 'server-only';
import type { MeResponse } from '@batimint/contracts';
import { cookies } from 'next/headers';
import { cache } from 'react';

export function apiInternalUrl(): string {
  return process.env['API_INTERNAL_URL'] ?? 'http://localhost:4000';
}

/** Appel serveur → API en relayant le cookie de session. */
export async function serverApi(path: string, init: RequestInit = {}): Promise<Response> {
  const cookieStore = await cookies();
  return fetch(`${apiInternalUrl()}/v1${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: cookieStore.toString(), accept: 'application/json' },
    cache: 'no-store',
  });
}

/** Une seule lecture de la session par requête (layout et page la demandent tous les deux). */
export const getMe = cache(async (): Promise<MeResponse | null> => {
  try {
    const res = await serverApi('/me');
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`API /me ${res.status}`);
    return (await res.json()) as MeResponse;
  } catch (err) {
    console.error('Impossible de joindre l’API', err);
    throw err;
  }
});
