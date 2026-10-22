import type { Buyer } from '@workspace/api-client-react';

type BuyerWithFixture = Buyer & { syntheticFixture?: boolean };

export type BuyerReadiness = {
  label: string;
  tone: 'stop' | 'warn' | 'go' | 'muted';
  detail: string;
};

export function buyerReadiness(buyer: BuyerWithFixture): BuyerReadiness {
  const synthetic = buyer.syntheticFixture === true ||
    /^(?:synthetic|fixture|test fixture|demo fixture)(?:\b|:)/i.test(buyer.source.trim());
  if (synthetic) return {
    label: 'Synthetic test data · excluded',
    tone: 'stop',
    detail: 'Fixture evidence is not evidence about a real buyer.',
  };

  const blockers = buyer.qualificationBlockers ?? [];
  if (buyer.currentBuyingStatus === 'NOT_BUYING') return {
    label: 'Not currently buying · excluded',
    tone: 'stop',
    detail: blockers.join(' ') || 'Current evidence says this buyer is not accepting opportunities.',
  };

  const contradictory = blockers.some((item) => /conflict|newer actual outreach reply|contradict/i.test(item));
  if (contradictory) return {
    label: 'Conflicting information · blocked',
    tone: 'stop',
    detail: blockers.filter((item) => /conflict|newer actual outreach reply|contradict|not buying/i.test(item)).join(' '),
  };

  if (buyer.verificationStatus === 'STALE' || buyer.approvalStatus === 'REVERIFICATION_REQUIRED') return {
    label: 'Evidence stale · re-review required',
    tone: 'warn',
    detail: blockers.join(' ') || 'Required evidence has expired.',
  };

  if (buyer.approvalStatus === 'APPROVED' && buyer.verificationStatus === 'VERIFIED') return {
    label: buyer.destinationKind && buyer.destinationKind !== 'BUYER'
      ? 'Destination evidence current · not funding proof'
      : 'Owner-reviewed evidence · current',
    tone: 'go',
    detail: buyer.destinationKind && buyer.destinationKind !== 'BUYER'
      ? 'Destination identity, criteria, and current-intent evidence passed review. This does not verify end-buyer funding or guarantee a closing.'
      : 'Owner-reviewed identity, funding, criteria, and current-buying evidence references are recorded. Source independence still depends on the reviewed evidence. This is not a guarantee of closing.',
  };

  if (buyer.verificationStatus === 'VERIFIED') return {
    label: 'Evidence reviewed · qualification incomplete',
    tone: 'muted',
    detail: blockers.join(' ') || 'Current buying and criteria still need review.',
  };

  if (buyer.currentBuyingStatus === 'BUYING') return {
    label: 'Reported interest · not independently verified',
    tone: 'muted',
    detail: blockers.join(' ') || 'A stated buying status is not verified current intent.',
  };

  return {
    label: 'Unverified · evidence missing',
    tone: 'muted',
    detail: blockers.join(' ') || 'No independently supported buyer readiness is recorded.',
  };
}
