/**
 * Proxy same-origin vers l'API (ADR 0003) : le navigateur ne parle qu'au domaine de l'interface,
 * les cookies de session restent first-party et le flux SSE est relayé sans mise en tampon.
 */
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'authorization',
  'content-type',
  'cookie',
  'idempotency-key',
  'last-event-id',
  'origin',
  'user-agent',
  'x-request-id',
];

const DROPPED_RESPONSE_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length']);

async function forward(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await params;
  const base = process.env['API_INTERNAL_URL'] ?? 'http://localhost:4000';
  const target = new URL(`/v1/${path.map(encodeURIComponent).join('/')}`, base);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip');
  if (clientIp) headers.set('x-forwarded-for', clientIp);
  headers.set('x-forwarded-host', request.headers.get('x-forwarded-host') ?? request.nextUrl.host);
  headers.set('x-forwarded-proto', request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', ''));

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: 'manual',
      signal: request.signal,
      cache: 'no-store',
      // @ts-expect-error -- requis par undici pour un corps en flux
      duplex: hasBody ? 'half' : undefined,
    });
  } catch {
    return Response.json(
      { error: { code: 'api_unreachable', message: 'Le service est momentanément indisponible. Réessayez dans un instant.' } },
      { status: 503 },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROPPED_RESPONSE_HEADERS.has(key) && key !== 'set-cookie') responseHeaders.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);
  if (upstream.headers.get('content-type')?.includes('text/event-stream')) {
    responseHeaders.set('cache-control', 'no-cache, no-transform');
    responseHeaders.set('x-accel-buffering', 'no');
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { forward as DELETE, forward as GET, forward as PATCH, forward as POST, forward as PUT };
