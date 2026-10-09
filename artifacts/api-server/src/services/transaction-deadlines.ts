import { createHash } from "node:crypto";
import type {
  TransactionMilestoneDeadlineItem,
  TransactionMilestoneDeadlineItemKind,
  TransactionMilestoneDeadlineSchedule,
} from "@workspace/api-zod";
import type { DealContract } from "@workspace/deal-domain";

export const TRANSACTION_DEADLINE_KINDS: readonly TransactionMilestoneDeadlineItemKind[] = [
  "TITLE_CLEARED",
  "INSPECTION_COMPLETED",
  "EARNEST_MONEY_CONFIRMED",
  "ASSIGNMENT_SIGNED",
  "FUNDS_CONFIRMED",
];

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

/** Fields that can change the contractual meaning of the recorded schedule. */
export function transactionTermsHash(contract: DealContract): string {
  return digest({
    offerId: contract.offerId,
    purchasePrice: contract.purchasePrice,
    assignmentTarget: contract.assignmentTarget,
    earnestMoney: contract.earnestMoney,
    assignmentAllowed: contract.assignmentAllowed,
    closingAt: contract.closingAt,
    contingencies: contract.contingencies,
    executedDocumentUrl: contract.executedDocumentUrl ?? null,
    sellerSignedAt: contract.sellerSignedAt ?? null,
    acquisitionSignedAt: contract.acquisitionSignedAt ?? null,
    committedBuyerId: contract.committedBuyerId ?? null,
    agreedBuyerPrice: contract.agreedBuyerPrice ?? null,
    buyerCommittedAt: contract.buyerCommittedAt ?? null,
  });
}

export function transactionDeadlineRequestHash(input: unknown): string {
  return digest(input);
}

export function isCalendarDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidTimeZone(value: string | null | undefined): value is string {
  if (!value?.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function calendarDateInZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export type DeadlineState = "NOT_DATED" | "NOT_APPLICABLE" | "INVALID" | "ON_TRACK" | "UPCOMING" | "OVERDUE";

/** Date-only contract deadlines remain calendar dates and are evaluated in the explicitly reviewed IANA zone. */
export function classifyMilestoneDeadline(
  item: Pick<TransactionMilestoneDeadlineItem, "disposition" | "dueDate" | "timeZone">,
  now: Date,
): DeadlineState {
  if (item.disposition === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (item.disposition === "NO_FIXED_DATE") return "NOT_DATED";
  if (item.disposition !== "DUE_DATE" || !isCalendarDate(item.dueDate) || !isValidTimeZone(item.timeZone)) return "INVALID";
  const today = calendarDateInZone(now, item.timeZone);
  const dayDelta = (Date.parse(`${item.dueDate}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86_400_000;
  if (dayDelta < 0) return "OVERDUE";
  if (dayDelta <= 7) return "UPCOMING";
  return "ON_TRACK";
}

export function scheduleCoversAllMilestones(
  schedule: TransactionMilestoneDeadlineSchedule | null | undefined,
): boolean {
  if (!schedule || schedule.items.length !== TRANSACTION_DEADLINE_KINDS.length) return false;
  const kinds = schedule.items.map(item => item.kind);
  return TRANSACTION_DEADLINE_KINDS.every(kind => kinds.filter(item => item === kind).length === 1);
}
