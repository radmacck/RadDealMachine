import { DomainError } from "@workspace/deal-domain";

export interface SigningEnvelopeRequest {
  documentId: string;
  leadId: string;
  templateKey: string;
  templateVersion: number;
  contentHash: string;
  economicsSnapshotHash: string;
  requiredSignerRoles: string[];
}

export interface SigningEnvelopeReceipt {
  provider: string;
  envelopeId: string;
  createdAt: string;
  contentHash: string;
  evidenceRef: string;
}

export interface VerifiedSignatureEvidence {
  provider: string;
  envelopeId: string;
  evidenceRef: string;
  contentHash: string;
  signedPartyRoles: string[];
  verifiedAt: string;
}

export interface SigningProviderAdapter {
  readonly status: {
    status: "CONNECTED" | "NOT_CONNECTED";
    provider: string | null;
    reason: string | null;
  };
  createEnvelope(request: SigningEnvelopeRequest): Promise<SigningEnvelopeReceipt>;
  verifySignatureEvidence(envelopeId: string): Promise<VerifiedSignatureEvidence>;
}

/**
 * No signing connector is bound in this workspace. This adapter fails closed
 * instead of manufacturing envelope IDs, webhooks, or signature confirmations.
 */
export const unavailableSigningProvider: SigningProviderAdapter = {
  status: {
    status: "NOT_CONNECTED",
    provider: null,
    reason: "No signing provider connection is attached to this workspace.",
  },
  async createEnvelope() {
    throw new DomainError("Signing is unavailable: connect a signing provider before creating an envelope.",503);
  },
  async verifySignatureEvidence() {
    throw new DomainError("Signature verification is unavailable: no connected signing provider can verify an envelope.",503);
  },
};
