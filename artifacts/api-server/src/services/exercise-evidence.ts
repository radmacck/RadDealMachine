import { randomUUID } from "node:crypto";
import { db, intelligenceTable } from "@workspace/db";
import type { UnderwritingInput } from "@workspace/deal-domain";

/** Conspicuously synthetic evidence for relational service exercises ONLY.
 * Never provides provenance for a real property or touches the public schema.
 */
export async function exerciseEvidence(id: string, input: UnderwritingInput, actor: string, now: Date): Promise<UnderwritingInput> {
  if (!/search_path=exercise_[a-f0-9]+/.test(process.env.PGOPTIONS??"")) throw new Error("Synthetic evidence requires an isolated exercise schema.");
  const evidence = async (category: string, contact = false) => {
    const evidenceId = randomUUID();
    await db.insert(intelligenceTable).values({id:evidenceId,leadId:id,createdBy:actor,createdAt:now,payload:{
      category,classification:contact?"INDICATED":"VERIFIED_FACTS",sourceType:contact?"SELLER":"INSPECTION",
      statement:`SYNTHETIC exercise evidence for ${category}; not a real document or business verification.`,
      source:"SYNTHETIC isolated service fixture",sourceUrl:"https://example.com/synthetic-evidence",
      verificationNote:"SYNTHETIC reviewed fixture, never an actual inspection or source verification.",
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