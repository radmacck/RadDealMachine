import { useState } from 'react';

/** Remembers the version a draft was started from so polling never silently rebases it. */
export function useBaseVersion(serverVersion: number) {
  const [base, setBase] = useState(serverVersion);
  return { base, stale: serverVersion !== base, rebase: () => setBase(serverVersion), setBase };
}
