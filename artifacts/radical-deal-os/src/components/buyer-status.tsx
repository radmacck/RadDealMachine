import type { Buyer } from '@workspace/api-client-react';

export function VerificationTag({ buyer }: { buyer: Buyer }) {
  const v = buyer.verificationStatus;
  return <span className={`tag ${v === 'VERIFIED' ? 'tone-go' : v === 'STALE' ? 'tone-warn' : 'tone-muted'}`} data-testid={`tag-verification-${buyer.id}`}>{v === 'VERIFIED' ? 'Human verified' : v}</span>;
}
export const isQualified = (b: Buyer) => b.approvalStatus === 'APPROVED';

export function ApprovalTag({ buyer }: { buyer: Buyer }) {
  const a = buyer.approvalStatus ?? 'DISCOVERED';
  const tone = a === 'APPROVED' ? 'tone-go' : a === 'REVERIFICATION_REQUIRED' ? 'tone-warn' : 'tone-muted';
  return <span className={`tag ${tone}`} data-testid={`tag-approval-${buyer.id}`}>{a.replace(/_/g, ' ')}</span>;
}
export const isApproved = (b: Buyer) => b.approvalStatus === 'APPROVED';
