import test from "node:test";
import assert from "node:assert/strict";
import { evidenceReadiness } from "./evidence-readiness";
import type { Intelligence, Lead, UnderwritingInput } from "./types";
const now = new Date("2026-10-04T12:00:00Z");
const lead = {id:"synthetic",sellerPhone:"000-000-0000"} as Lead;
const input: UnderwritingInput = {version:1,conditionConfirmed:true,repairsComplete:true,
  subjectEvidenceId:"subject",conditionEvidenceId:"condition",sellerContactEvidenceId:"contact",
  comps:[{id:"c1",address:"SYNTHETIC COMP",salePrice:300000,sqft:1000,soldAt:"2026-10-01",distanceMiles:0.1,
    propertyType:"SINGLE_FAMILY",condition:"RENOVATED",source:"SYNTHETIC",verified:true,saleEvidenceId:"sale",conditionEvidenceId:"renovation"}],
  repairs:[{category:"Roof",low:1,expected:2,high:3,confidence:0.9,source:"SYNTHETIC",evidenceId:"roof"}]};
const entries = [["subject","subject_property"],["condition","subject_condition"],["contact","seller_contact"],["sale","comp_sale:c1"],["renovation","comp_condition:c1"],["roof","repair_scope:roof"]].map(([id,category])=>({
  id,category,leadId:"synthetic",
  classification:id==="contact"?"OBSERVED":"VERIFIED_FACTS",
  sourceType:id==="contact"?"PUBLIC_PAGE":"INSPECTION",
  statement:"SYNTHETIC reviewed evidence",source:"SYNTHETIC fixture",
  sourceUrl:"https://example.com/synthetic",capturedAt:now.toISOString(),verificationNote:"Synthetic review",confidence:0.9,createdBy:"synthetic",createdAt:now.toISOString(),
   ...(id==="contact"?{
     contactPermissionStatus:"PERMITTED",contactPermissionEvidenceUrl:"https://example.com/synthetic-permission",
     contactPath:{
       id:"contact",channel:"PHONE",recipient:"SYNTHETIC TEST RECIPIENT",routeValue:"000-000-0000",postalCode:null,
       classification:"OBSERVED",confidence:0.9,sourceId:"synthetic-contact-source",sourceName:"SYNTHETIC source",
       sourceRecordId:"SYNTHETIC-CONTACT-1",capturedAt:now.toISOString(),
       freshUntilAt:new Date(now.getTime()+30*86400000).toISOString(),freshnessStatus:"CURRENT",
       permissionStatus:"PERMITTED",contactPermissionEvidenceUrl:"https://example.com/synthetic-permission",
       permissionReviewedAt:now.toISOString(),sourceType:"SELLER",recipientRole:"UNKNOWN",
       routeVerificationStatus:"CONFIRMED",routeReviewedAt:now.toISOString(),
       verificationNote:"SYNTHETIC owner review; no real person or contact data.",
       identityStatus:"UNVERIFIED",signingAuthorityStatus:"NOT_ESTABLISHED",identityConflictStatus:"NONE",
     },
   }:{}),
})) as Intelligence[];
test("checkboxes cannot create sourced property readiness",()=>{
  assert.ok(evidenceReadiness(lead,{...input,subjectEvidenceId:undefined,conditionEvidenceId:undefined},entries,now).length>=2);
});
test("complete linked human-reviewed packet passes and missing/future/foreign evidence does not",()=>{
  assert.deepEqual(evidenceReadiness(lead,input,entries,now),[]);
  assert.ok(evidenceReadiness(lead,input,entries.filter(e=>e.id!=="sale"),now).some(b=>b.includes("sale")));
  assert.ok(evidenceReadiness(lead,input,entries.map(e=>({...e,leadId:"another-property"})),now).length>0);
  assert.ok(evidenceReadiness(lead,input,entries.map(e=>({...e,capturedAt:"2026-10-05T12:00:00Z"})),now).length>0);
});
test("model output and observed condition cannot become underwriting verification",()=>{
  for (const classification of ["AI_HYPOTHESIS","OBSERVED"] as const) {
    assert.ok(evidenceReadiness(lead,input,entries.map(e=>e.id==="condition"?{...e,classification}:e),now).some(b=>b.includes("Subject condition")));
  }
});
test("source observations can identify a subject; seller-provided contact permission remains linked evidence",()=>{
  const observed = entries.map(e=>e.id==="subject"?{...e,classification:"OBSERVED" as const,sourceType:"PUBLIC_RECORD" as const}:
    e.id==="contact"?{...e,classification:"OBSERVED" as const,sourceType:"SELLER" as const,sourceUrl:undefined}:e);
  assert.deepEqual(evidenceReadiness(lead,input,observed,now),[]);
  assert.ok(evidenceReadiness(lead,input,observed,new Date(now.getTime()+31*86400000)).length>0);
});
test("CALL READY contact evidence must be a current, reviewed, source-backed phone route",()=>{
  const indicated = entries.map(e=>e.id==="contact"?{...e,classification:"INDICATED" as const}:e);
  assert.ok(evidenceReadiness(lead,input,indicated,now).some(item=>/observed or independently verified/.test(item)));
  const wrongSource = entries.map(e=>e.id==="contact"?{...e,sourceType:"INSPECTION" as const}:e);
  assert.ok(evidenceReadiness(lead,input,wrongSource,now).some(item=>/identifiable permitted source/.test(item)));
  const noLink = entries.map(e=>e.id==="contact"?{...e,sourceUrl:undefined}:e);
  assert.ok(evidenceReadiness(lead,input,noLink,now).some(item=>/link the public\/permitted source/.test(item)));
  const unreviewedPermission = entries.map(e=>e.id==="contact"?{...e,contactPermissionStatus:"NOT_REVIEWED" as const}:e);
  assert.ok(evidenceReadiness(lead,input,unreviewedPermission,now).some(item=>/contact permission is not recorded/.test(item)));
  const missingPermissionEvidence = entries.map(e=>e.id==="contact"?{...e,contactPermissionEvidenceUrl:undefined}:e);
  assert.ok(evidenceReadiness(lead,input,missingPermissionEvidence,now).some(item=>/link evidence for permission/.test(item)));
  const unconfirmedRoute = entries.map(e=>e.id==="contact"?{
    ...e,contactPath:{...e.contactPath!,routeVerificationStatus:"UNREVIEWED" as const},
  }:e);
  assert.ok(evidenceReadiness(lead,input,unconfirmedRoute,now).some(item=>/must be owner-confirmed/.test(item)));
  const staleRoute = entries.map(e=>e.id==="contact"?{
    ...e,contactPath:{...e.contactPath!,freshnessStatus:"STALE" as const,freshUntilAt:now.toISOString()},
  }:e);
  assert.ok(evidenceReadiness(lead,input,staleRoute,now).some(item=>/selected phone route is stale/.test(item)));
  const conflictingRoute = entries.map(e=>e.id==="contact"?{
    ...e,contactPath:{...e.contactPath!,identityConflictStatus:"MULTIPLE_RECIPIENTS" as const},
  }:e);
  assert.ok(evidenceReadiness(lead,input,conflictingRoute,now).some(item=>/conflicting recipient identity/.test(item)));
  const emailOnly = entries.map(e=>e.id==="contact"?{
    ...e,contactPath:{...e.contactPath!,channel:"EMAIL" as const,routeValue:"synthetic@example.com"},
  }:e);
  assert.ok(evidenceReadiness(lead,input,emailOnly,now).some(item=>/only a phone route/.test(item)));
  const contact = entries.find(e=>e.id==="contact")!.contactPath!;
  assert.equal(contact.identityStatus,"UNVERIFIED");
  assert.equal(contact.signingAuthorityStatus,"NOT_ESTABLISHED",
    "A callable route must not silently promote seller identity or signing authority.");
  assert.ok(evidenceReadiness({...lead,sellerPhone:""},input,entries,now)
    .some(item=>/postal-only and is not CALL READY/.test(item)));
});