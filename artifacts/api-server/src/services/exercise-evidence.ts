import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, intelligenceTable, leadsTable } from "@workspace/db";
import type { UnderwritingInput } from "@workspace/deal-domain";

/** Conspicuously synthetic evidence for relational service exercises ONLY.
 * Never provides provenance for a real property or touches the public schema.
 */
export async function exerciseEvidence(id: string, input: UnderwritingInput, actor: string, now: Date): Promise<UnderwritingInput> {
  if (!/search_path=exercise_[a-f0-9]+/.test(process.env.PGOPTIONS??"")) throw new Error("Synthetic evidence requires an isolated exercise schema.");
  const [lead] = await db.select({payload:leadsTable.payload}).from(leadsTable).where(eq(leadsTable.id,id));
  const leadPhone = typeof lead?.payload.sellerPhone === "string" ? lead.payload.sellerPhone.trim() : "";
  if (!leadPhone) throw new Error("Synthetic readiness exercises must supply the lead's explicitly labeled contact route; no route is invented.");
  const evidence = async (category: string, contact = false) => {
    const evidenceId = randomUUID();
    const sourceName = "SYNTHETIC isolated service fixture";
    const verificationNote = "SYNTHETIC reviewed fixture, never an actual inspection or source verification.";
    const contactPath = contact ? {
      id:evidenceId,channel:"PHONE" as const,recipient:"SYNTHETIC exercise seller",routeValue:leadPhone,postalCode:null,
      classification:"OBSERVED" as const,confidence:0.9,sourceId:"synthetic-exercise-contact",sourceName,
      sourceRecordId:`SYNTHETIC-${id}-CONTACT`,sourceUrl:"https://example.com/synthetic-evidence",
      capturedAt:now.toISOString(),freshUntilAt:new Date(now.getTime()+30*86400000).toISOString(),
      freshnessStatus:"CURRENT" as const,permissionStatus:"PERMITTED" as const,
      contactPermissionEvidenceUrl:"https://example.com/synthetic-contact-permission",permissionReviewedAt:now.toISOString(),
      sourceType:"SELLER" as const,recipientRole:"SELLER_SELF_IDENTIFIED" as const,
      routeVerificationStatus:"CONFIRMED" as const,routeReviewedAt:now.toISOString(),
      verificationNote,identityStatus:"UNVERIFIED" as const,signingAuthorityStatus:"NOT_ESTABLISHED" as const,
      supportingObservationCount:1,
    } : undefined;
    await db.insert(intelligenceTable).values({id:evidenceId,leadId:id,createdBy:actor,createdAt:now,payload:{
       category,classification:contact?"OBSERVED":"VERIFIED_FACTS",sourceType:contact?"SELLER":"INSPECTION",
      statement:`SYNTHETIC exercise evidence for ${category}; not a real document or business verification.`,
      source:sourceName,sourceUrl:"https://example.com/synthetic-evidence",
      verificationNote,
       ...(contact?{
         contactPermissionStatus:"PERMITTED",
         contactPermissionEvidenceUrl:"https://example.com/synthetic-contact-permission",
          contactPath,
       }:{}),
      capturedAt:now.toISOString(),confidence:0.9,
    }});
    return evidenceId;
  };
  const result = {...input,
    subjectEvidenceId:await evidence("subject_property"),conditionEvidenceId:await evidence("subject_condition"),
    sellerContactEvidenceId:await evidence("seller_contact",true),comps:[...input.comps],repairs:[...input.repairs]};
  for (let i=0;i<result.comps.length;i++) {
    const c = result.comps[i]!;
    result.comps[i] = {...c,saleEvidenceId:await evidence(`comp_sale:${c.id.toLowerCase()}`),conditionEvidenceId:await evidence(`comp_condition:${c.id.toLowerCase()}`)};
  }
  for (let i=0;i<result.repairs.length;i++) {
    const r = result.repairs[i]!;
    result.repairs[i] = {...r,evidenceId:await evidence(`repair_scope:${r.category.trim().toLowerCase()}`)};
  }
  return result;
}