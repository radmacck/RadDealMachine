import type { HumanHandoff, HandoffEventInput } from "./handoffs";
import type { IntelligenceInput } from "./types";
import { validateProvenance } from "./provenance";
import { DomainError } from "./types";

/**
 * Provider-independent reply adapter. A human-reported seller reply is retained
 * as an indication, not parsed into property facts or commercial authority.
 */
export function sellerHandoffReplyEvidence(h: HumanHandoff, event: HandoffEventInput, now: Date): IntelligenceInput {
  if (h.subjectType!=="SELLER"||event.kind!=="REPLIED")
    throw new DomainError("Seller reply evidence requires a seller handoff and an actual reply.");
  const evidence: IntelligenceInput = {
    classification:"INDICATED",category:"seller_outreach_reply",sourceType:"SELLER",
    statement:`Human-reported reply from ${h.recipient}: ${event.note}`,
    source:`Human handoff ${h.id}, event ${event.eventKey}`,sourceUrl:event.evidenceUrl,
    capturedAt:event.occurredAt,confidence:0.5,
    question:"What changed, and which statements require independent verification?",
    action:"Review through the seller call and evidence-intake workflows. Financial/authority changes require reviewed underwriting and owner approval; this reply grants neither.",
  };
  validateProvenance(evidence,now);
  return evidence;
}