export function versionedStageTransition(input: {
  leadId: string;
  priorVersion: number;
  priorStage: string;
  nextStage: string;
  actor: string;
  occurredAt: Date;
  reason: string;
  nextAction: string;
  analysisSnapshotId?: string | null;
}) {
  return {
    eventType: "CANONICAL_STAGE_TRANSITION",
    leadId: input.leadId,
    priorVersion: input.priorVersion,
    resultingVersion: input.priorVersion + 1,
    priorStage: input.priorStage,
    resultingStage: input.nextStage,
    actor: input.actor,
    occurredAt: input.occurredAt.toISOString(),
    reason: input.reason,
    nextAction: input.nextAction,
    evidenceRefs: input.analysisSnapshotId ? [input.analysisSnapshotId] : [],
  };
}
