import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type PurchaseReviewSnapshot = {
  leadId: string;
  contractId: string;
  offerId: string;
  analysisSnapshotId: string;
  economicsSnapshotHash: string;
  attemptNumber: number;
  propertyAddress: string;
  sellerReportedName: string | null;
  purchasePrice: number;
  earnestMoney: number;
  closingAt: string;
  contingencies: string;
  assignmentAllowed: boolean;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function purchaseReviewSnapshotHash(snapshot: PurchaseReviewSnapshot): string {
  return createHash("sha256").update(canonical(snapshot)).digest("hex");
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export async function buildPurchaseReviewPdf(snapshot: PurchaseReviewSnapshot, snapshotHash: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Purchase terms review copy");
  pdf.setSubject("Terms copied from the current communicated seller offer and transaction record");
  pdf.setProducer("Radical Deal OS");
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.10, 0.15, 0.20);
  const muted = rgb(0.35, 0.40, 0.45);
  const accent = rgb(0.10, 0.34, 0.50);
  const form = pdf.getForm();

  page.drawText("PURCHASE TERMS", { x: 44, y: 744, size: 20, font: bold, color: ink });
  page.drawText("REVIEW COPY - NOT A CONTRACT OR SIGNATURE", { x: 44, y: 723, size: 9, font: bold, color: accent });
  page.drawText(`Deal ${snapshot.leadId}  |  Attempt ${snapshot.attemptNumber}`, { x: 44, y: 704, size: 8, font: regular, color: muted });
  page.drawText(`Current source offer ${snapshot.offerId}`, { x: 44, y: 691, size: 8, font: regular, color: muted });
  page.drawText("Authorized transaction terms", { x: 44, y: 660, size: 12, font: bold, color: ink });

  const rows: Array<[string, string]> = [
    ["Property", snapshot.propertyAddress],
    ["Seller name on file (must verify legal party)", snapshot.sellerReportedName || "Not provided"],
    ["Purchase price", money(snapshot.purchasePrice)],
    ["Earnest money", money(snapshot.earnestMoney)],
    ["Target closing deadline", snapshot.closingAt],
    ["Contingencies recorded with offer", snapshot.contingencies || "None recorded"],
    ["Assignment intent recorded with offer", snapshot.assignmentAllowed ? "Allowed in the approved offer" : "Not allowed in the approved offer"],
  ];
  let y = 636;
  for (const [label, value] of rows) {
    page.drawText(label, { x: 44, y, size: 8, font: bold, color: muted });
    const shownValue = value.length > 92 ? `${value.slice(0, 89)}...` : value;
    page.drawText(shownValue, { x: 202, y, size: 9, font: regular, color: ink, maxWidth: 360 });
    page.drawLine({ start: { x: 44, y: y - 7 }, end: { x: 568, y: y - 7 }, thickness: 0.5, color: rgb(0.84, 0.87, 0.89) });
    y -= 30;
  }

  y -= 4;
  page.drawText("Fillable fields for legal review", { x: 44, y, size: 12, font: bold, color: ink });
  page.drawText("These blanks are not inferred from property or seller records.", { x: 44, y: y - 14, size: 8, font: regular, color: muted });
  y -= 39;

  const fieldRows: Array<[string, string]> = [
    ["Seller legal name / entity", "seller_legal_name"],
    ["Acquisition entity / buyer", "acquisition_entity"],
    ["Parcel number / legal description", "parcel_legal_description"],
    ["Title or escrow company", "title_escrow_company"],
    ["Earnest-money holder", "earnest_money_holder"],
  ];
  for (const [label, name] of fieldRows) {
    page.drawText(label, { x: 44, y: y + 5, size: 8, font: bold, color: muted });
    const field = form.createTextField(name);
    field.addToPage(page, { x: 202, y: y - 1, width: 366, height: 20, font: regular, borderColor: rgb(0.66, 0.71, 0.75), borderWidth: 0.8 });
    field.setFontSize(9);
    y -= 30;
  }

  page.drawText("Additional terms for counsel to review", { x: 44, y: y + 5, size: 8, font: bold, color: muted });
  const additional = form.createTextField("additional_terms_for_review");
  additional.enableMultiline();
  additional.addToPage(page, { x: 202, y: y - 36, width: 366, height: 42, font: regular, borderColor: rgb(0.66, 0.71, 0.75), borderWidth: 0.8 });
  additional.setFontSize(8);

  page.drawText("IMPORTANT", { x: 44, y: 91, size: 8, font: bold, color: accent });
  page.drawText("This populated worksheet is not a purchase agreement, legal advice, an e-signature, or proof of execution.", {
    x: 44, y: 77, size: 7.5, font: regular, color: ink, maxWidth: 524,
  });
  page.drawText("Use a jurisdiction-approved agreement, verify parties and blanks, obtain actual signatures outside this worksheet,", {
    x: 44, y: 65, size: 7.5, font: regular, color: ink, maxWidth: 524,
  });
  page.drawText("then record the executed document and signature evidence in the transaction workflow.", {
    x: 44, y: 53, size: 7.5, font: regular, color: ink, maxWidth: 524,
  });
  page.drawText(`Terms snapshot SHA-256: ${snapshotHash}`, { x: 44, y: 33, size: 6.5, font: regular, color: muted });
  page.drawText(`Underwriting economics SHA-256: ${snapshot.economicsSnapshotHash}`, { x: 44, y: 22, size: 6.5, font: regular, color: muted });

  form.updateFieldAppearances(regular);
  return pdf.save();
}
