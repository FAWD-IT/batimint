'use client';

import type { MeResponse } from '@batimint/contracts';
import type { Action } from '@batimint/domain';
import { createContext, type ReactNode, useContext } from 'react';

const SessionContext = createContext<MeResponse | null>(null);

export function SessionProvider({ me, children }: { me: MeResponse; children: ReactNode }) {
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}

export function useSession(): MeResponse {
  const me = useContext(SessionContext);
  if (!me) throw new Error('useSession hors de SessionProvider');
  return me;
}

/** Masquage côté web (la vérité reste l'API). */
export function useCan(): (action: Action) => boolean {
  const me = useSession();
  return (action) => me.permissions.includes(action);
}
