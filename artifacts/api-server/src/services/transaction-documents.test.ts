import assert from "node:assert/strict";
import test from "node:test";
import { assembleContractDataPackage, type PurchaseReviewSnapshot } from "./transaction-documents";

const terms: PurchaseReviewSnapshot = {
  leadId: "lead-source", contractId: "contract-1", offerId: "offer-1", analysisSnapshotId: "analysis-1",
  economicsSnapshotHash: "a".repeat(64), attemptNumber: 1, propertyAddress: "123 Example St",
  sellerReportedName: "Reported Seller", purchasePrice: 100000, earnestMoney: 1000,
  closingAt: "2026-11-01", contingencies: "Inspection period", assignmentAllowed: true,
};

test("contract data assembly links every populated field to its actual source and labels unverified parties", () => {
  const assembled = assembleContractDataPackage(terms, {
    version: 1, jurisdiction: "US/PA/EXAMPLE-COUNTY", purchaseTemplateStatus: "MISSING_APPROVED_TEMPLATE",
    signingProviderConnected: false,
  });
  assert.ok(assembled.sourceLinks.some(source => source.field === "Authorized purchase terms" &&
    source.sourceId === terms.offerId && source.status === "AUTHORIZED"));
  assert.ok(assembled.sourceLinks.some(source => source.field === "Underwriting/economics" &&
    source.sourceId === terms.analysisSnapshotId && source.status === "UNDERWRITING_SNAPSHOT"));
  assert.ok(assembled.sourceLinks.every(source => source.href.startsWith("/api/deals/")));
  assert.ok(assembled.sourceLinks.some(source => source.field === "Seller name on file" &&
    source.status === "RECORDED_UNVERIFIED"));
  assert.equal(assembled.jurisdiction.determination, "PROPERTY_LOCATION_ONLY_NOT_LEGAL_ADVICE");
});

test("missing legal parties, template and signing provider block signature routing without inventing values", () => {
  const assembled = assembleContractDataPackage(terms, {
    version: 1, jurisdiction: "US/PA/EXAMPLE-COUNTY", purchaseTemplateStatus: "MISSING_APPROVED_TEMPLATE",
    signingProviderConnected: false,
  });
  assert.equal(assembled.signatureRouting.status, "BLOCKED");
  assert.ok(assembled.missingRequiredData.includes("Seller legal identity evidence"));
  assert.ok(assembled.missingRequiredData.includes("Seller signing-authority evidence"));
  assert.ok(assembled.missingRequiredData.includes("Acquisition entity legal name and authority evidence"));
  assert.ok(assembled.signatureRouting.blockers.some(item => item.includes("signature-routing provider")));
  assert.ok(assembled.disclosures.some(item => item.item === "Assignment status" && item.included));
  assert.match(assembled.clauseNotice, /not generated or inserted/);
});

test("party review cannot compensate for a missing approved template or disconnected signing provider", () => {
  const verifiedParties = { priorPartyIdentityVerified:true, priorSigningAuthorityVerified:true };
  const noApprovedTemplate = assembleContractDataPackage(terms, {
    version:1,jurisdiction:"US/PA/EXAMPLE-COUNTY",purchaseTemplateStatus:"MISSING_APPROVED_TEMPLATE",
    signingProviderConnected:true,...verifiedParties,
  });
  assert.equal(noApprovedTemplate.signatureRouting.status,"BLOCKED");
  assert.ok(noApprovedTemplate.signatureRouting.blockers.some(item=>item.includes("jurisdiction-approved purchase agreement template")));

  const noSigningProvider = assembleContractDataPackage(terms, {
    version:1,jurisdiction:"US/PA/EXAMPLE-COUNTY",purchaseTemplateStatus:"APPROVED_LEGAL",
    signingProviderConnected:false,...verifiedParties,
  });
  assert.equal(noSigningProvider.signatureRouting.status,"BLOCKED");
  assert.ok(noSigningProvider.signatureRouting.blockers.some(item=>item.includes("signature-routing provider")));
});

test("changed terms or assembly version produce a different immutable package hash", () => {
  const input = { version: 1, jurisdiction: "US/PA/EXAMPLE-COUNTY", purchaseTemplateStatus: "REVIEW_COPY_ONLY", signingProviderConnected: false };
  const first = assembleContractDataPackage(terms, input);
  const changedTerms = assembleContractDataPackage({ ...terms, purchasePrice: 101000 }, input);
  const changedVersion = assembleContractDataPackage(terms, { ...input, version: 2 });
  assert.notEqual(first.snapshotHash, changedTerms.snapshotHash);
  assert.notEqual(first.snapshotHash, changedVersion.snapshotHash);
  assert.equal(first.disclosures.find(item => item.item === "Purchase price")?.value, "$100000");
});
