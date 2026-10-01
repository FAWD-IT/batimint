import { type NextRequest, NextResponse } from 'next/server';

/**
 * Vérification optimiste : sans cookie de session, on renvoie directement vers la connexion
 * (la vraie vérification est faite par l'API dans le layout de l'application).
 */
const PUBLIC_PREFIXES = ['/connexion', '/inscription', '/mot-de-passe', '/p/', '/s/', '/api/', '/_next/', '/favicon', '/icons/', '/manifest', '/sw.js', '/invitation'];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (request.cookies.has('bm_session')) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = '/connexion';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webp|jpg|js|json|txt)$).*)'],
};
