import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAcquisitionQueueQueryKey, getGetCallQueueQueryKey, getGetCommandCenterQueryKey,
  getGetDashboardQueryKey, getGetLeadQueryKey, getListAuditQueryKey,
  getListLeadsQueryKey, getListPropertyDiscoveriesQueryKey,
} from '@workspace/api-client-react';

export function useInvalidateWork() {
  const qc = useQueryClient();
  return useCallback(
    (leadId?: string) => {
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetCallQueueQueryKey() });
      qc.invalidateQueries({ queryKey: getGetAcquisitionQueueQueryKey() });
      qc.invalidateQueries({ queryKey: getGetCommandCenterQueryKey() });
      qc.invalidateQueries({ queryKey: getListAuditQueryKey() });
      qc.invalidateQueries({ queryKey: getListPropertyDiscoveriesQueryKey() });
      const prefixes = ['/api/buyers', '/api/deals', '/api/workers', '/api/handoffs'];
      qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && prefixes.some((p) => (q.queryKey[0] as string).startsWith(p)) });
      if (leadId) qc.invalidateQueries({ queryKey: getGetLeadQueryKey(leadId) });
    },
    [qc],
  );
}
