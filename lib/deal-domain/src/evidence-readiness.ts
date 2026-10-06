import type { Analysis, Intelligence, Lead, UnderwritingInput } from "./types";

/** Review references to existing same-deal evidence; a checkbox is not provenance.
 * This composes with the financial engine, which remains deterministic and offline.
 */
export function evidenceReadiness(lead: Lead, input: UnderwritingInput|null, entries: Intelligence[], now: Date): string[] {
  if (!input) return ["Collect a sourced underwriting evidence package."];
  const blockers: string[] = [];
  const review = (id: string|undefined, categories: string[], label: string, days = 30, mode: "FACT"|"SUBJECT"|"CONTACT" = "FACT") => {
    const e = entries.find(e=>e.id===id);
    if (!e || e.leadId!==lead.id || !categories.includes(e.category.trim().toLowerCase())) {
      blockers.push(`${label}: select same-property evidence classified for ${categories.join(" or ")}.`); return;
    }
    const age = now.getTime()-Date.parse(e.capturedAt);
    if (!Number.isFinite(age)||age<0||age>=days*86400000) blockers.push(`${label}: evidence is future, invalid or at least ${days} days old.`);
    if (e.sourceType==="MODEL" || e.classification==="AI_HYPOTHESIS") blockers.push(`${label}: AI hypotheses cannot support readiness.`);
    if (mode==="FACT" && (e.classification!=="VERIFIED_FACTS"||!["PUBLIC_RECORD","INSPECTION"].includes(e.sourceType)||!e.verificationNote?.trim())) {
      blockers.push(`${label}: independently reviewed public-record/inspection evidence is required.`);
    }
    if (mode==="SUBJECT" && !(["OBSERVED","VERIFIED_FACTS"].includes(e.classification)&&["PUBLIC_RECORD","INSPECTION"].includes(e.sourceType))) {
      blockers.push(`${label}: sourced public-record/inspection observation is required.`);
    }
    if (mode==="CONTACT") {
      if (!["OBSERVED","VERIFIED_FACTS"].includes(e.classification)) {
        blockers.push(`${label}: the phone route must be observed or independently verified; an indication is insufficient.`);
      }
      if (!["PUBLIC_RECORD","PERMITTED_LISTING","PUBLIC_PAGE","SELLER","ANALYST"].includes(e.sourceType)) {
        blockers.push(`${label}: the phone route needs an identifiable permitted source or seller-provided record.`);
      }
      if (!e.verificationNote?.trim()) blockers.push(`${label}: record how the route and source were reviewed.`);
      if (e.sourceType!=="SELLER" && !/^https:\/\//i.test(e.sourceUrl??"")) {
        blockers.push(`${label}: link the public/permitted source that supplied the phone route.`);
      }
      if (e.contactPermissionStatus!=="PERMITTED") {
        blockers.push(`${label}: contact permission is not recorded as permitted.`);
      }
      if (!/^https:\/\//i.test(e.contactPermissionEvidenceUrl??"")) {
        blockers.push(`${label}: link evidence for permission to use this contact route.`);
      }
    }
    if (mode!=="CONTACT" && !/^https?:\/\//i.test(e.sourceUrl??"")) blockers.push(`${label}: link the actual source document.`);
  };
  review(input.subjectEvidenceId,["subject_property","source_property_snapshot"],"Subject property",30,"SUBJECT");
  review(input.conditionEvidenceId,["subject_condition"],"Subject condition");
  if (lead.sellerPhone?.trim()) review(input.sellerContactEvidenceId,["seller_contact"],"Seller contact",30,"CONTACT");
  else blockers.push("Seller contact: no direct phone route is recorded; a tax-roll mailing address is postal-only and is not CALL READY.");
  for (const c of input.comps.filter(c=>c.verified)) {
    review(c.saleEvidenceId,[`comp_sale:${c.id.toLowerCase()}`],`Comparable ${c.address} sale`,180);
    if (c.condition==="RENOVATED") review(c.conditionEvidenceId,[`comp_condition:${c.id.toLowerCase()}`],`Comparable ${c.address} renovation`,180);
  }
  for (const observation of input.repairObservations ?? []) {
    const e = entries.find(entry => entry.id === observation.evidenceId);
    const category = `repair_scope:${observation.category.trim().toLowerCase()}`;
    if (!e || e.leadId!==lead.id || e.category.trim().toLowerCase()!==category) {
      blockers.push(`Repair observation ${observation.category}: select same-property inspection evidence classified for ${category}.`);
      continue;
    }
    const age = now.getTime()-Date.parse(e.capturedAt);
    if (!Number.isFinite(age)||age<0||age>=30*86400000) blockers.push(`Repair observation ${observation.category}: inspection evidence is future, invalid or at least 30 days old.`);
    if (e.sourceType!=="INSPECTION"||e.classification!=="VERIFIED_FACTS"||!e.verificationNote?.trim()||!/^https?:\/\//i.test(e.sourceUrl??"")) {
      blockers.push(`Repair observation ${observation.category}: independently reviewed, linked inspection evidence is required; raw assessor codes and model output are insufficient.`);
    }
  }
  for (const r of input.repairs) review(r.evidenceId,[`repair_scope:${r.category.trim().toLowerCase()}`],`Repair scope ${r.category}`);
  return [...new Set(blockers)];
}

export function evidenceReviewedAnalysis(analysis: Analysis|null, lead: Lead, input: UnderwritingInput|null, entries: Intelligence[], now: Date): Analysis|null {
  if (!analysis) return null;
  const blockers = [...new Set([...analysis.blockers,...evidenceReadiness(lead,input,entries,now)])];
  return {...analysis,blockers,classification:blockers.length?"INCOMPLETE":analysis.classification};
}