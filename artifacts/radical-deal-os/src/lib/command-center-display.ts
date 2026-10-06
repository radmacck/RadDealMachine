export type CommandActionRef = { category: string; leadId: string | null };
export type CallBriefRef = { lead: { id: string } };

/**
 * Keep the selected call inside the single highest-priority action, and do not
 * repeat that same seller as a second independent "next" item.
 */
export function commandCenterCallDisplay<Action extends CommandActionRef, Call extends CallBriefRef>(
  primaryAction: Action | null | undefined,
  calls: Call[],
): { primaryCall: Call | null; additionalCalls: Call[] } {
  const isCallAction = ["CALL", "FOLLOW_UP", "NEGOTIATION"].includes(primaryAction?.category ?? "");
  const primaryCall = isCallAction
    ? calls.find((call) => call.lead.id === primaryAction?.leadId) ?? null
    : null;
  const additionalCalls = calls.filter((call) => call.lead.id !== primaryAction?.leadId);
  return { primaryCall, additionalCalls };
}
