import type { Buyer } from '@workspace/api-client-react';

export function VerificationTag({ buyer }: { buyer: Buyer }) {
  const v = buyer.verificationStatus;
  return <span className={`tag ${v === 'VERIFIED' ? 'tone-go' : v === 'STALE' ? 'tone-warn' : 'tone-muted'}`} data-testid={`tag-verification-${buyer.id}`}>{v === 'VERIFIED' ? 'Human verified' : v}</span>;
}
export const isQualified = (b: Buyer) => b.status === 'ACTIVE' && b.verificationStatus === 'VERIFIED';
