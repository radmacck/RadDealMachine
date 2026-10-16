import type { OfferApprovalInput, OfferActor } from "@workspace/deal-domain";
import { authorizeOffer, getOfferReview } from "./offer-store";

/** Isolated exercises fetch the same immutable packet a signed-in owner reviews. */
export async function authorizeReviewedOffer(id:string,offerId:string,input:OfferApprovalInput,actor:OfferActor,now=new Date()) {
  const packet=await getOfferReview(id,offerId);
  return authorizeOffer(id,offerId,{...input,reviewSnapshotHash:packet.reviewSnapshotHash},actor,now);
}
