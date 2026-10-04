import { createContext, useContext } from 'react';
import type { Access } from '@workspace/api-client-react';

export interface AccessCtx {
  access: Access;
  canResearch: boolean;
  canCall: boolean;
  isOwner: boolean;
}
export const AccessContext = createContext<AccessCtx | null>(null);
export function useAccess() {
  const c = useContext(AccessContext);
  if (!c) throw new Error('useAccess outside AccessGate');
  return c;
}
