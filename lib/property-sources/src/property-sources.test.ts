import test from "node:test";
import assert from "node:assert/strict";
import { candidateSales, normalizeProperty, PHILA_SOURCE, propertyById, searchProperties } from "./index";
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