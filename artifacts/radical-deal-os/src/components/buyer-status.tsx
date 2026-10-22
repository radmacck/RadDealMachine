import type { Buyer } from '@workspace/api-client-react';
import { buyerReadiness } from '@/lib/buyer-readiness';

export function VerificationTag({ buyer }: { buyer: Buyer }) {
  const readiness = buyerReadiness(buyer);
  const tone = readiness.tone === 'go' ? 'tone-go' : readiness.tone === 'warn' ? 'tone-warn' : readiness.tone === 'stop' ? 'tone-stop' : 'tone-muted';
  return <span className={`tag ${tone}`} title={readiness.detail} data-testid={`tag-verification-${buyer.id}`}>{readiness.label}</span>;
}
export const isQualified = (b: Buyer) => b.approvalStatus === 'APPROVED';

export function ApprovalTag({ buyer }: { buyer: Buyer }) {
  const a = buyer.approvalStatus ?? 'DISCOVERED';
  const tone = a === 'APPROVED' ? 'tone-go' : a === 'REVERIFICATION_REQUIRED' ? 'tone-warn' : 'tone-muted';
  const labels: Record<string, string> = {
    APPROVED: buyer.destinationKind && buyer.destinationKind !== 'BUYER'
      ? 'Destination + current intent reviewed'
      : 'Criteria + current intent reviewed',
    REVERIFICATION_REQUIRED: 'Re-review required',
    QUALIFICATION_REQUIRED: 'More evidence required',
    DISCOVERED: 'Discovered · not verified',
  };
  return <span className={`tag ${tone}`} data-testid={`tag-approval-${buyer.id}`}>{labels[a] ?? a.replace(/_/g, ' ')}</span>;
}
export const isApproved = (b: Buyer) => b.approvalStatus === 'APPROVED';
