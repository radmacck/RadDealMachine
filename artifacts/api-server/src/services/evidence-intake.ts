import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { db, intelligenceTable } from "@workspace/db";
import { IntakePropertyEvidenceBody } from "@workspace/api-zod";
import { assertOperationsRole, DomainError, validateProvenance, type OfferActor } from "@workspace/deal-domain";
import { audit, lockedLead, saveUnderwriting, updateLead } from "./deal-store";

/** Atomic structured input adapter, not evidence generation or automatic verification.
 * Human/source supplied classifications are validated; approval remains a separate command.
 */
export async function intakePropertyEvidence(id: string, input: z.infer<typeof IntakePropertyEvidenceBody>, actor: OfferActor, now = new Date()) {
  assertOperationsRole(actor,["OWNER","ANALYST"]);
  const packet = IntakePropertyEvidenceBody.parse(input);
  if (packet.underwriting.version!==packet.version) throw new DomainError("Packet and underwriting versions must refer to the same reviewed deal.",409);
  const keys = packet.entries.map(e=>e.key);
  if (new Set(keys).size!==keys.length) throw new DomainError("Evidence packet keys must be unique.");
  for (const {key:_,...entry} of packet.entries) validateProvenance(entry,now);
  return db.transaction(async tx=>{
    await lockedLead(tx,id,packet.version);
    const updated = await updateLead(id,{...packet.lead,version:packet.version},actor.id,now,tx);
    const ids = new Map(keys.map(key=>[key,randomUUID()]));
    for (const {key,...entry} of packet.entries) {
      await tx.insert(intelligenceTable).values({id:ids.get(key)!,leadId:id,createdBy:actor.id,createdAt:now,payload:entry});
      await audit(tx,actor.id,"INTELLIGENCE_ADDED",id,`${entry.classification} / ${entry.category}; source ${entry.source}; packet key ${key}. No auto-promotion or seller contact performed.`);
    }
    const ref = (key?: string) => key ? ids.get(key)??key : undefined;
    const underwriting = {...packet.underwriting,version:updated.version,
      subjectEvidenceId:ref(packet.underwriting.subjectEvidenceId),
      conditionEvidenceId:ref(packet.underwriting.conditionEvidenceId),
      sellerContactEvidenceId:ref(packet.underwriting.sellerContactEvidenceId),
      comps:packet.underwriting.comps.map(c=>({...c,saleEvidenceId:ref(c.saleEvidenceId),conditionEvidenceId:ref(c.conditionEvidenceId)})),
      repairs:packet.underwriting.repairs.map(r=>({...r,evidenceId:ref(r.evidenceId)})),
    };
    const result = await saveUnderwriting(id,underwriting,actor.id,now,tx);
    await audit(tx,actor.id,"PROPERTY_EVIDENCE_INTAKE",id,`${packet.entries.length} source records atomically stored with evidence-linked deterministic snapshot. No offer authorized, call made or external document verified by software.`);
    return result;
  });
}