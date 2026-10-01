/**
 * Client HTTP du navigateur : passe par le proxy same-origin /api/v1 (ADR 0003).
 * Les erreurs de l'API sont déjà rédigées en français clair avec une solution.
 */
import { v7 as uuidv7 } from 'uuid';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Clé d'idempotence ; générée automatiquement pour les POST si absente. */
  idempotencyKey?: string | false;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && options.idempotencyKey !== false) headers['idempotency-key'] = options.idempotencyKey ?? uuidv7();
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network_error', '');
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? '', e?.details);
  }
  return data as T;
}
