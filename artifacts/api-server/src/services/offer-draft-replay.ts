import { createHash } from "node:crypto";
import type { OfferDraftInput } from "@workspace/deal-domain";

type OfferReplayRecord = { createdBy: string; payload: Record<string, unknown> };

export function offerDraftReplayHash(input: OfferDraftInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function isExactOfferDraftReplay(
  existing: OfferReplayRecord,
  input: OfferDraftInput,
  actorId: string,
): boolean {
  return existing.createdBy === actorId
    && existing.payload.idempotencyHash === offerDraftReplayHash(input);
}
