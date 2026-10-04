import type { z } from "zod";
import type {
  CreateLeadResponse, CreateLeadBody, AddIntelligenceBody, AddIntelligenceResponse,
  SaveUnderwritingBody, UpdateAssumptionsBody, GetLeadResponse, TransitionLeadBody,
  RecordCallBody, GetCallQueueResponse,
} from "@workspace/api-zod";

export type Lead = z.infer<typeof CreateLeadResponse>;
export type LeadInput = z.infer<typeof CreateLeadBody>;
export type IntelligenceInput = z.infer<typeof AddIntelligenceBody>;
export type Intelligence = z.infer<typeof AddIntelligenceResponse>;
export type UnderwritingInput = z.infer<typeof SaveUnderwritingBody>;
export type Assumptions = z.infer<typeof UpdateAssumptionsBody>;
export type LeadDetail = z.infer<typeof GetLeadResponse>;
export type Analysis = NonNullable<LeadDetail["analysis"]>;
export type Stage = Lead["stage"];
export type TransitionInput = z.infer<typeof TransitionLeadBody>;
export type CallInput = z.infer<typeof RecordCallBody>;
export type CallBrief = z.infer<typeof GetCallQueueResponse>[number];

export class DomainError extends Error {
  constructor(message: string, public readonly status = 422) {
    super(message);
    this.name = "DomainError";
  }
}