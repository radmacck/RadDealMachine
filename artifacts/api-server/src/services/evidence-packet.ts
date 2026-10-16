import { createHash } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import {
  analysesTable,auditTable,buyersTable,callsTable,contractsTable,db,distributionPacketsTable,
  distributionRecipientsTable,evidencePacketExportsTable,intelligenceTable,jobsTable,leadsTable,
  matchesTable,offersTable,propertyDiscoveriesTable,transactionReadinessExceptionsTable,transitionsTable,
} from "@workspace/db";
import { DomainError } from "@workspace/deal-domain";
import { leadDetail } from "./deal-store";

type Purpose="INTERNAL_REVIEW"|"OWNER_AUDIT"|"TITLE_HANDOFF"|"LEGAL_REVIEW"|"BUYER_HANDOFF";
const alwaysPrivate=/(token|password|secret|authorization|pdfbase64|privatekey)/i;
const personal=/(address|street|zip|postal|phone|email|sellername|buyername|ownername|fullname|personal|contactdetails|contactroute|contactname)/i;
function sanitize(value:unknown,allowSensitive:boolean):unknown {
  const privateValues:string[]=[];
  const collect=(v:unknown,key="")=>{
    if(!v||typeof v!=="object"){if(!allowSensitive&&personal.test(key)&&typeof v==="string"&&v.length>=3)privateValues.push(v);return;}
    if(Array.isArray(v)){for(const item of v)collect(item,key);return;}
    for(const [k,item] of Object.entries(v as Record<string,unknown>))collect(item,k);
  };
  collect(value);
  privateValues.sort((a,b)=>b.length-a.length);
  const cleanString=(s:string)=>privateValues.reduce((out,secret)=>out.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"gi"),"[REDACTED]"),s);
  const walk=(v:unknown):unknown=>{
  if(typeof v==="string")return allowSensitive?v:cleanString(v);
  if(Array.isArray(v))return v.map(walk);
  if(!v||typeof v!=="object")return v;
  const out:Record<string,unknown>={};
  for(const [key,item] of Object.entries(v as Record<string,unknown>)) {
    if(alwaysPrivate.test(key)||(!allowSensitive&&personal.test(key))) {out[key]="[REDACTED]";continue;}
    out[key]=walk(item);
  }
  return out;
  };
  return walk(value);
}
function recordClass(payload:unknown,fallback:"SYNTHETIC"|"UNMARKED"="UNMARKED") {
  const p=payload&&typeof payload==="object"?payload as Record<string,unknown>:{};
  return p.synthetic===true||p.fixture===true?"SYNTHETIC":fallback;
}
function stable(v:unknown):string {
  if(Array.isArray(v))return `[${v.map(stable).join(",")}]`;
  if(v&&typeof v==="object")return `{${Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${stable(x)}`).join(",")}}`;
  return JSON.stringify(v);
}
export async function exportDealEvidencePacket(id:string,actor:{id:string;role:string},purpose:Purpose,includeSensitive=false) {
  if(!["OWNER","OPERATOR","ANALYST"].includes(actor.role))throw new DomainError("Not authorized to export deal evidence.",403);
  if(!["INTERNAL_REVIEW","OWNER_AUDIT","TITLE_HANDOFF","LEGAL_REVIEW","BUYER_HANDOFF"].includes(purpose))throw new DomainError("Select a valid recipient purpose.",400);
  const allowSensitive=actor.role==="OWNER"&&purpose==="OWNER_AUDIT"&&includeSensitive;
  return db.transaction(async tx=>{
    const [leadRow]=await tx.select().from(leadsTable).where(eq(leadsTable.id,id)).for("update");
    if(!leadRow)throw new DomainError("Property lead not found.",404);
    const parentClass=recordClass(leadRow.payload);
    const detail=await leadDetail(id,tx);
    const discoveryId=(detail.lead.propertyQualification as {discoveryId?:string}|undefined)?.discoveryId;
    const discoveryIdQuery=discoveryId?await tx.select().from(propertyDiscoveriesTable).where(eq(propertyDiscoveriesTable.id,discoveryId)): [];
    const analyses=await tx.select().from(analysesTable).where(eq(analysesTable.leadId,id)).orderBy(analysesTable.createdAt);
    const calls=await tx.select().from(callsTable).where(eq(callsTable.leadId,id)).orderBy(callsTable.createdAt);
    const intel=await tx.select().from(intelligenceTable).where(eq(intelligenceTable.leadId,id)).orderBy(intelligenceTable.createdAt);
    const offers=await tx.select().from(offersTable).where(eq(offersTable.leadId,id)).orderBy(offersTable.createdAt);
    const contracts=await tx.select().from(contractsTable).where(eq(contractsTable.leadId,id)).orderBy(contractsTable.createdAt);
    const matches=await tx.select().from(matchesTable).where(eq(matchesTable.leadId,id));
    const audit=await tx.select().from(auditTable).where(eq(auditTable.entityId,id)).orderBy(auditTable.createdAt);
    const exceptions=await tx.select().from(transactionReadinessExceptionsTable).where(eq(transactionReadinessExceptionsTable.leadId,id)).orderBy(transactionReadinessExceptionsTable.createdAt);
    const jobs=await tx.select().from(jobsTable).where(eq(jobsTable.leadId,id)).orderBy(jobsTable.createdAt);
    const packets=await tx.select().from(distributionPacketsTable).where(eq(distributionPacketsTable.leadId,id)).orderBy(distributionPacketsTable.createdAt);
    const prior=await tx.select().from(evidencePacketExportsTable).where(eq(evidencePacketExportsTable.leadId,id)).orderBy(desc(evidencePacketExportsTable.version));
    const buyerIds=[...new Set(matches.map(row=>row.buyerId))];
    const buyerRows=buyerIds.length?await tx.select().from(buyersTable).where(inArray(buyersTable.id,buyerIds)):[];
    const packetIds=packets.map(row=>row.id);
    const recipients=packetIds.length?await tx.select().from(distributionRecipientsTable).where(inArray(distributionRecipientsTable.packetId,packetIds)):[];
    const sections={
      propertyLineage:{discovery:discoveryIdQuery[0]?{...discoveryIdQuery[0],recordClass:recordClass(discoveryIdQuery[0].payload,parentClass)}:null,qualification:detail.lead.propertyQualification??null},
      underwriting:{current:detail.analysis,snapshots:analyses.map(row=>({id:row.id,createdBy:row.createdBy,createdAt:row.createdAt,snapshot:row.snapshot}))},
      sellerNotes:{calls,reportedAndObservedIntelligence:intel},
      buyerVerification:{matches:matches.map(row=>({...row,recordClass:recordClass(row.payload,parentClass)})),buyers:buyerRows.map(row=>({id:row.id,version:row.version,updatedAt:row.updatedAt,payload:row.payload,recordClass:recordClass(row.payload,parentClass)}))},
      offers:offers.map(row=>({...row,recordClass:recordClass(row.payload,parentClass)})),
      packages:packets.map(row=>({...row,recordClass:recordClass(row.snapshot,parentClass),recipients:recipients.filter(r=>r.packetId===row.id).map(r=>({...r,recordClass:recordClass(r.payload,parentClass)}))})),
      contracts:contracts.map(row=>({...row,recordClass:recordClass(row.payload,parentClass)})),
      contractAndDealEvents:{
        transitions:detail.transitions.map(row=>({...row,recordClass:parentClass})),
        audit:audit.map(row=>({...row,recordClass:parentClass})),
        workerJobs:jobs.map(row=>({...row,recordClass:recordClass(row.payload,parentClass)})),
      },
      unresolvedExceptions:exceptions.filter(e=>e.status==="OPEN").map(row=>({...row,recordClass:row.synthetic||parentClass==="SYNTHETIC"?"SYNTHETIC":"UNMARKED"})),
    };
    const counts={synthetic:0,unmarked:0};
    const classifyRows=(rows:Array<{payload?:unknown;snapshot?:unknown}>)=>rows.map(row=>{
      const cls=recordClass(row.payload??row.snapshot,parentClass);counts[cls==="SYNTHETIC"?"synthetic":"unmarked"]++;
      return {...row,recordClass:cls};
    });
    const classified={
      ...sections,
      sellerNotes:{calls:classifyRows(calls),reportedAndObservedIntelligence:classifyRows(intel)},
      underwriting:{current:detail.analysis,snapshots:classifyRows(analyses)},
    };
    const allRecords:unknown[]=[
      ...analyses.map(r=>r.snapshot),...calls.map(r=>r.payload),...intel.map(r=>r.payload),...offers.map(r=>r.payload),
      ...contracts.map(r=>r.payload),...matches.map(r=>r.payload),...buyerRows.map(r=>r.payload),
      ...packets.map(r=>r.snapshot),...recipients.map(r=>r.payload),...jobs.map(r=>r.payload),
      ...exceptions.map(r=>({synthetic:r.synthetic})),...(discoveryIdQuery[0]?[discoveryIdQuery[0].payload]:[]),leadRow.payload,
    ];
    counts.synthetic=allRecords.filter(p=>recordClass(p,parentClass)==="SYNTHETIC").length;
    counts.unmarked=allRecords.length-counts.synthetic;
    const packet={
      format:"RADICAL_DEAL_EVIDENCE_PACKET_V1",
      deal:{id,version:leadRow.version,stage:leadRow.stage,createdAt:leadRow.createdAt,updatedAt:leadRow.updatedAt,
        recordClass:recordClass(leadRow.payload),property:detail.lead},
      purpose,redaction:allowSensitive?"OWNER_AUDIT_AUTHORIZED":"PERSONAL_AND_PRIVATE_FIELDS_REDACTED",
      recordClassification:{synthetic:counts.synthetic,unmarked:counts.unmarked,unmarkedIsNotProofOfRealData:true},
      sections:classified,
      priorExports:prior.map(row=>({id:row.id,version:row.version,contentHash:row.contentHash,purpose:row.purpose,generatedBy:row.generatedBy,createdAt:row.createdAt,redactionLevel:row.redactionLevel})),
    };
    const snapshot=sanitize(packet,allowSensitive) as Record<string,unknown>;
    const hash=createHash("sha256").update(stable(snapshot)).digest("hex");
    const version=(prior[0]?.version??0)+1,createdAt=new Date();
    const [saved]=await tx.insert(evidencePacketExportsTable).values({leadId:id,version,contentHash:hash,generatedBy:actor.id,purpose,
      redactionLevel:allowSensitive?"OWNER_AUDIT_AUTHORIZED":"REDACTED",snapshot,createdAt}).returning();
    await tx.insert(auditTable).values({actor:actor.id,action:"DEAL_EVIDENCE_PACKET_EXPORTED",entityId:id,
      detail:`Evidence packet v${version} exported for ${purpose}; ${allowSensitive?"sensitive fields authorized":"sensitive fields redacted"}; sha256 ${hash}.`,createdAt});
    return {export:{id:saved!.id,version,contentHash:hash,generatedBy:actor.id,purpose,redactionLevel:saved!.redactionLevel,createdAt},...snapshot};
  });
}
