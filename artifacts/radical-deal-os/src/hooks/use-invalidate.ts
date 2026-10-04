import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCallQueueQueryKey, getGetDashboardQueryKey, getGetLeadQueryKey,
  getListAuditQueryKey, getListLeadsQueryKey,
} from '@workspace/api-client-react';

export function useInvalidateWork() {
  const qc = useQueryClient();
  return useCallback(
    (leadId?: string) => {
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetCallQueueQueryKey() });
      qc.invalidateQueries({ queryKey: getListAuditQueryKey() });
      if (leadId) qc.invalidateQueries({ queryKey: getGetLeadQueryKey(leadId) });
    },
    [qc],
  );
}
