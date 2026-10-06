import type { z } from "zod";
import type {
  CreateLeadResponse, CreateLeadBody, AddIntelligenceBody, AddIntelligenceResponse,
  SaveUnderwritingBody, UpdateAssumptionsBody, GetLeadResponse, TransitionLeadBody,
  RecordCallBody, GetCallQueueResponse,
  CreateOfferDraftBody, AuthorizeOfferBody, CommunicateOfferBody, WithdrawOfferBody,
  Repair, RepairEstimate, RepairEstimateLine, RepairObservation, RepairRateCard,
} from "@workspace/api-zod";

export type Lead = z.infer<typeof CreateLeadResponse>;
export type LeadInput = z.infer<typeof CreateLeadBody>;
export type IntelligenceInput = z.infer<typeof AddIntelligenceBody>;
export type Intelligence = z.infer<typeof AddIntelligenceResponse>;
export type UnderwritingInput = z.infer<typeof SaveUnderwritingBody>;
export type Assumptions = z.infer<typeof UpdateAssumptionsBody>;
export type LeadDetail = z.infer<typeof GetLeadResponse>;
export type DealWorkGuidance = NonNullable<LeadDetail["workGuidance"]>;
export type LeadDetailWithoutWorkGuidance = Omit<LeadDetail, "workGuidance">;
export type Analysis = NonNullable<LeadDetail["analysis"]>;
export type Stage = Lead["stage"];
export type TransitionInput = z.infer<typeof TransitionLeadBody>;
export type CallInput = z.infer<typeof RecordCallBody>;
export type CallBrief = z.infer<typeof GetCallQueueResponse>[number];
export type Offer = LeadDetail["offers"][number];
export type StoredOffer = Omit<Offer,"effectiveStatus"|"blockers">;
export type OfferDraftInput = z.infer<typeof CreateOfferDraftBody>;
export type OfferApprovalInput = z.infer<typeof AuthorizeOfferBody>;
export type OfferCommunicationInput = z.infer<typeof CommunicateOfferBody>;
export type OfferWithdrawalInput = z.infer<typeof WithdrawOfferBody>;
export type { Repair, RepairEstimate, RepairEstimateLine, RepairObservation, RepairRateCard };

export class DomainError extends Error {
  constructor(message: string, public readonly status = 422) {
    super(message);
    this.name = "DomainError";
  }
}