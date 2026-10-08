import test from "node:test";
import assert from "node:assert/strict";
import { ConnectorRegistry } from "./connector-registry";
import {
  candidateSales, normalizeCorporateGrantee, normalizeProperty, PHILA_SOURCE, propertyById,
  discoverPhiladelphiaViolationParcels, rankContactPaths, refreshPhiladelphiaEnforcementEvidence,
  refreshPhiladelphiaVacancyEvidence, searchProperties, normalizePhiladelphiaPermitRows,
  normalizePhiladelphiaDemolitionRows, PHILA_LI_PERMITS_SOURCE, PHILA_DEMOLITIONS_SOURCE,
} from "./index";
const now = new Date("2026-10-04T12:00:00Z");
const raw = {
  parcel_number:"123456789",location:"123 SYNTHETIC TEST ST",category_code_description:"SINGLE FAMILY",
  building_code_description:"ROW 2 STY MASONRY",total_livable_area:1000,number_of_bedrooms:3,number_of_bathrooms:2,
  zip_code:"19143",owner_1:"SYNTHETIC LLC",market_value:210000,sale_price:170000,sale_date:"2026-09-01T04:00:00Z",
  interior_condition:"2",exterior_condition:"2",lat:39.95,lng:-75.2,
};
test("official observations retain source, nullable gaps and distinct assessment/prior sale semantics",()=>{
  const p = normalizeProperty({...raw,number_of_bedrooms:null,owner_1:null},now);
  assert.equal(p.classification,"OBSERVED");
  assert.equal(p.beds,null); assert.equal(p.recordedOwner,null);
  assert.equal(p.assessedValue,210000); assert.equal(p.lastSalePrice,170000);
  assert.equal(p.propertyType,"TOWNHOUSE"); assert.equal(p.lastSaleAt,"2026-09-01");
  assert.ok(p.sourceUrl.endsWith(raw.parcel_number)); assert.equal(p.capturedAt,now.toISOString());
  assert.equal("askingPrice" in p,false); assert.equal("arv" in p,false);
});
test("corporate tax owner is only an observed research candidate, never buyer approval",()=>{
  const p = normalizeProperty(raw,now);
  assert.equal(p.entityCandidate,true);
  assert.equal("verificationStatus" in p,false); assert.equal("fundsAvailable" in p,false);
  assert.ok(PHILA_SOURCE.limitations.some(s=>s.includes("purchasing intent/funding")));
});
test("OPA mailing contact route is source-backed, freshness-bounded, and never treated as permission",()=>{
  const property = normalizeProperty({
    ...raw,
    owner_2:"SYNTHETIC CO-OWNER",
    mailing_care_of:"SYNTHETIC CONTACT",
    mailing_address_1:"PO BOX 100",
    mailing_address_2:"SUITE 2",
    mailing_city_state:"Philadelphia PA",
    mailing_zip:"19143",
  },now);
  assert.equal(property.county,"Philadelphia");
  assert.equal(property.contactPaths.length,1);
  const path = property.contactPaths[0]!;
  assert.equal(path.channel,"POSTAL");
  assert.equal(path.classification,"OBSERVED");
  assert.equal(path.permissionStatus,"NOT_REVIEWED");
  assert.equal(path.sourceId,PHILA_SOURCE.id);
  assert.equal(path.sourceRecordId,raw.parcel_number);
  assert.deepEqual(path.addressLines,["SYNTHETIC CONTACT","PO BOX 100","SUITE 2"]);
  assert.equal(path.recipient,"SYNTHETIC LLC / SYNTHETIC CO-OWNER");
  assert.equal(rankContactPaths([path],new Date(now.getTime()+31*24*60*60*1000))[0]!.freshnessStatus,"STALE");
  assert.equal(normalizeProperty(raw,now).contactPaths.length,0);
});
test("contact route ranking collapses duplicate source observations and keeps the strongest permitted current provenance",()=>{
  const first=normalizeProperty({
    ...raw,mailing_address_1:"100 ROUTE TEST AVE",mailing_city_state:"Philadelphia PA",mailing_zip:"19143",
  },now).contactPaths[0]!;
  const duplicate={...first,id:"other-source-copy",sourceId:"permitted-directory",
    sourceName:"Permitted directory",sourceRecordId:"directory-123",sourceUrl:"https://example.com/record",
    permissionStatus:"PERMITTED" as const,classification:"VERIFIED" as const,confidence:0.8,
    supportingObservations:undefined};
  const separate={...first,id:"other-address",addressLines:["200 SECOND ROUTE ST"]};
  const phone={...first,id:"phone-1",channel:"PHONE" as const,routeValue:"(215) 555-0100",addressLines:[],cityState:null,postalCode:null};
  const duplicatePhone={...phone,id:"phone-2",sourceId:"other-directory",routeValue:"215-555-0100",
    sourceName:"Other directory",sourceRecordId:"phone-456",sourceUrl:"https://example.com/phone"};
  const prohibitedPhone={...phone,id:"phone-0",permissionStatus:"PROHIBITED" as const};
  const email={...first,id:"email-1",channel:"EMAIL" as const,routeValue:"first.last@example.com",addressLines:[],cityState:null,postalCode:null};
  const similarButDifferentEmail={...email,id:"email-2",routeValue:"firstlast@example.com"};
  const ranked=rankContactPaths([first,duplicate,separate,phone,duplicatePhone,prohibitedPhone,email,similarButDifferentEmail],now);
  assert.equal(ranked.length,5,"Duplicate postal/phone routes collapse, while distinct routes remain visible.");
  assert.equal(ranked[0]?.id,"other-source-copy");
  assert.equal(ranked[0]?.sourceUrl,"https://example.com/record");
  assert.equal(ranked[0]?.permissionStatus,"PERMITTED");
  assert.equal(ranked[0]?.freshnessStatus,"CURRENT");
  assert.equal(ranked[0]?.supportingObservationCount,2);
  assert.equal(ranked[0]?.supportingObservations?.length,2,"The merged route retains both source records.");
  assert.equal(ranked[0]?.identityConflictStatus,"NONE");
  assert.ok(ranked[0]?.rankingReasons?.[0]?.includes("Rank 1 of"));
  assert.ok(ranked.some(path=>path.channel==="PHONE"&&path.id==="phone-1"));
  assert.equal(ranked.filter(path=>path.channel==="PHONE").length,1);
  assert.equal(ranked.filter(path=>path.channel==="EMAIL").length,2,
    "Email normalization must not merge different mailboxes.");
  assert.equal(ranked.find(path=>path.channel==="PHONE")?.id,"phone-1");
  assert.equal(ranked.find(path=>path.channel==="PHONE")?.permissionStatus,"NOT_REVIEWED",
    "A prohibited duplicate cannot outrank an unreviewed copy of the same route.");
  assert.equal(rankContactPaths([first],new Date(now.getTime()+31*86400000))[0]?.freshnessStatus,"STALE");
});
test("contact route ranking prefers phone over email only after permission, freshness, evidence and confidence tie",()=>{
  const property=normalizeProperty({...raw,mailing_address_1:"100 ROUTE TEST AVE",mailing_city_state:"Philadelphia PA"},now);
  const postal=property.contactPaths[0]!;
  const email={...postal,id:"email",channel:"EMAIL" as const,routeValue:"owner@example.test",addressLines:[],cityState:null,
    permissionStatus:"PERMITTED" as const,routeVerificationStatus:"CONFIRMED" as const,classification:"VERIFIED" as const,confidence:0.9};
  const phone={...email,id:"phone",channel:"PHONE" as const,routeValue:"215-555-0142"};
  const ranked=rankContactPaths([email,phone],now);
  assert.equal(ranked[0]?.channel,"PHONE");
  assert.ok(ranked[0]?.rankingReasons?.some(reason=>reason.includes("preferred route for a call-ready")));
  assert.ok(ranked[1]?.rankingReasons?.[0]?.includes("Rank 2 of 2"));
});
test("same-route records with conflicting recipient or role claims remain visible and flagged for review",()=>{
  const first=normalizeProperty({...raw,mailing_address_1:"100 ROUTE TEST AVE",mailing_city_state:"Philadelphia PA"},now).contactPaths[0]!;
  const shared={...first,id:"synthetic-phone-a",channel:"PHONE" as const,routeValue:"(215) 555-0142",
    addressLines:[],cityState:null,permissionStatus:"PERMITTED" as const,routeVerificationStatus:"CONFIRMED" as const,
    supportingObservations:undefined};
  const second={...shared,id:"synthetic-phone-b",recipient:"SYNTHETIC DIFFERENT PERSON",sourceId:"synthetic-source-b",
    sourceName:"SYNTHETIC source B",sourceRecordId:"SYNTHETIC-RECORD-B",recipientRole:"DIRECTORY_CONTACT" as const};
  const [reconciled]=rankContactPaths([shared,second],now);
  assert.equal(reconciled?.supportingObservations?.length,2);
  assert.equal(reconciled?.identityConflictStatus,"MULTIPLE_RECIPIENTS");
  assert.equal(reconciled?.recipientIdentityClaimCount,2);
  assert.equal(reconciled?.identityStatus,"UNVERIFIED");
  assert.equal(reconciled?.signingAuthorityStatus,"NOT_ESTABLISHED");
});
test("unverified condition is not promoted by a favorable assessment condition code",()=>{
  const subject = normalizeProperty(raw,now);
  const candidate = normalizeProperty({...raw,parcel_number:"223456789",location:"125 SYNTHETIC TEST ST",lat:39.9501},now);
  const results = candidateSales(subject,[candidate,candidate,subject],{radius:1,ageDays:180,sizeTolerance:0.2},now);
  assert.equal(results.length,1);
  assert.equal(results[0]!.comp.condition,"UNKNOWN"); assert.equal(results[0]!.comp.verified,false);
});
test("sale candidates reject distance, age, future dates, size, property type and bed/bath mismatches",()=>{
  const subject = normalizeProperty(raw,now);
  const changes = [
    {lat:40.95}, {sale_date:"2024-01-01T00:00:00Z"}, {sale_date:"2027-01-01T00:00:00Z"},
    {total_livable_area:2000}, {building_code_description:"DETACHED SINGLE FAMILY"},
    {number_of_bedrooms:6}, {number_of_bathrooms:5}, {sale_price:0},
  ];
  changes.forEach(change=>{
    const other = normalizeProperty({...raw,parcel_number:"223456789",location:"125 SYNTHETIC TEST ST",...change},now);
    assert.equal(candidateSales(subject,[other],{radius:1,ageDays:180,sizeTolerance:0.2},now).length,0);
  });
});
test("malformed source values and arbitrary identifiers/ZIP SQL fragments fail explicitly",async()=>{
  assert.throws(()=>normalizeProperty({...raw,sale_date:"not-a-date"},now));
  assert.throws(()=>normalizeProperty({...raw,number_of_bedrooms:-1},now));
  await assert.rejects(()=>propertyById("123' OR 1=1"),/Invalid official/);
  await assert.rejects(()=>searchProperties("19143' OR 1=1","properties"),/ZIP/);
});
test("supplemental City evidence requires bounded exact parcel identifiers before any network call",async()=>{
  await assert.rejects(()=>refreshPhiladelphiaEnforcementEvidence(["12345678"],now),/exact nine-digit/);
  await assert.rejects(()=>refreshPhiladelphiaVacancyEvidence(Array.from({length:41},()=> "123456789"),now),/at most 40/);
  await assert.rejects(()=>discoverPhiladelphiaViolationParcels(now,21),/1–20 parcels/);
});
test("recent residential permits retain distinct source records as OBSERVED context, never as motivation",()=>{
  const permit = {
    permitnumber:"EP-2026-SYNTHETIC-01", opa_account_num:"123456789",
    permitissuedate:"2026-10-01T04:00:00Z", status:"Issued",
    permittype:"Building", permitdescription:"SYNTHETIC repair permit",
    typeofwork:"Repair", approvedscopeofwork:"SYNTHETIC scope", commercialorresidential:"Residential",
    address:"123 SYNTHETIC TEST ST", zip:"19143", objectid:7001,
  };
  const observations = normalizePhiladelphiaPermitRows([
    permit, permit,
    {...permit, permitnumber:"EP-2026-SYNTHETIC-02", permitissuedate:"2026-09-29T04:00:00Z"},
    {...permit, permitnumber:"EP-2026-FUTURE", permitissuedate:"2026-10-05T04:00:00Z"},
    {...permit, permitnumber:"EP-2025-STALE", permitissuedate:"2026-01-01T04:00:00Z"},
    {...permit, opa_account_num:"12345678", permitnumber:"EP-2026-NO-EXACT-PARCEL"},
  ],now);
  assert.equal(observations.length,1);
  assert.equal(observations[0]?.sourceId,PHILA_LI_PERMITS_SOURCE.id);
  assert.equal(observations[0]?.payload.recordCount,2);
  assert.equal((observations[0]?.payload.recordIdentities as string[]).length,2);
  assert.equal(observations[0]?.payload.classification,"OBSERVED");
  assert.equal(observations[0]?.signal,null,"Permit activity is source context, not a seller-motivation signal.");
  assert.equal(observations[0]?.payload.identityMethod,"EXACT_OPA_ACCOUNT");
  assert.equal((observations[0]?.payload.freshness as {state:string})?.state,"SOURCE_RECORDS_WITHIN_WINDOW");
  assert.equal((observations[0]?.payload.sourceReliability as {numericScore:number|null})?.numericScore,null,
    "Do not invent a numeric reliability score the public dataset does not provide.");
  assert.equal(((observations[0]?.payload.records as Array<{freshness:{state:string}}>)[0]?.freshness.state),"WITHIN_SOURCE_WINDOW");
  assert.match(observations[0]?.sourceUrl ?? "",/opendataphilly\.org\/datasets\/licenses-and-inspections-building-and-zoning-permits/);
  assert.equal((observations[0]?.payload.records as Array<{classification:string}>)[0]?.classification,"OBSERVED");
});
test("recent demolition records remain dated OBSERVED evidence and exact-account failures do not become property matches",()=>{
  const demolition = {
    caseorpermitnumber:"SYNTHETIC-DEMO-01", opa_account_num:"987654321",
    start_date:"2025-10-01T04:00:00Z", completed_date:"2025-12-01T04:00:00Z",
    status:"COMPLETED", record_type:"PERMIT", typeofwork:"MINOR DEMOLITION",
    typeofworkdescription:"SYNTHETIC work", address:"456 SYNTHETIC TEST ST",
    zip:"19143", city_demo:"NO", objectid:8001,
  };
  const observations = normalizePhiladelphiaDemolitionRows([
    demolition, demolition,
    {...demolition, caseorpermitnumber:"SYNTHETIC-OLD", start_date:"2023-01-01T04:00:00Z"},
    {...demolition, caseorpermitnumber:"SYNTHETIC-NO-OPA", opa_account_num:null},
  ],now);
  assert.equal(observations.length,1);
  assert.equal(observations[0]?.propertyId,"987654321");
  assert.equal(observations[0]?.sourceId,PHILA_DEMOLITIONS_SOURCE.id);
  assert.equal(observations[0]?.payload.recordCount,1);
  assert.equal(observations[0]?.signal,null);
  assert.equal(observations[0]?.payload.classification,"OBSERVED");
  assert.match(observations[0]?.sourceUrl ?? "",/opendataphilly\.org\/datasets\/building-demolitions/);
});
test("repeated recorded grantees reject ambiguous names rather than treating them as buyers",()=>{
  assert.equal(normalizeCorporateGrantee("Example Property Holdings LLC"),"Example Property Holdings LLC");
  assert.equal(normalizeCorporateGrantee("Jane Smith"),null);
  assert.equal(normalizeCorporateGrantee("Example Holdings LLC AND Seller LLC"),null);
  assert.equal(normalizeCorporateGrantee("Example Holdings LLC; Seller LLC"),null);
});
test("replaceable source registry has no product-level connector-count ceiling",()=>{
  const registry = new ConnectorRegistry<{id:string; sourceType:string}>();
  for(let index=0;index<128;index++) registry.register({id:`source-${index}`,sourceType:"replaceable-adapter"});
  assert.equal(registry.all().length,128);
  assert.equal(registry.get("source-127")?.sourceType,"replaceable-adapter");
  assert.throws(()=>registry.register({id:"source-127",sourceType:"duplicate"}),/already registered/);
});