export type DealTimelineCategory =
  | "ACQUISITION" | "UNDERWRITING" | "SELLER" | "BUYER" | "DISTRIBUTION" | "TRANSACTION" | "CLOSING";

export type DealTimelineEvent = {
  id: string;
  at: string;
  recordedAt?: string;
  category: DealTimelineCategory;
  title: string;
  detail: string;
  evidence: string;
  href?: string;
};

export const TIMELINE_FILTERS: Array<{ value: DealTimelineCategory | "ALL"; label: string }> = [
  { value: "ALL", label: "All activity" },
  { value: "ACQUISITION", label: "Discovery & qualification" },
  { value: "UNDERWRITING", label: "Underwriting" },
  { value: "SELLER", label: "Seller & outreach" },
  { value: "BUYER", label: "Buyer" },
  { value: "DISTRIBUTION", label: "Packages" },
  { value: "TRANSACTION", label: "Contract & milestones" },
  { value: "CLOSING", label: "Closing & outcomes" },
];

export function buildDealTimeline(events: DealTimelineEvent[], filter: string = "ALL"): DealTimelineEvent[] {
  const unique = new Map<string, DealTimelineEvent>();
  for (const event of events) {
    if (!event.id.trim() || !Number.isFinite(Date.parse(event.at))) continue;
    if (filter !== "ALL" && event.category !== filter) continue;
    if (!unique.has(event.id)) unique.set(event.id, event);
  }
  return [...unique.values()].sort((a, b) =>
    Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
}
