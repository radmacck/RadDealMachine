export type CanonicalStageVersionClock = { currentVersion: number };

export function versionedStageTransition(input: {
  leadId: string;
  priorVersion: number;
  versionClock?: CanonicalStageVersionClock;
  priorStage: string;
  nextStage: string;
  actor: string;
  occurredAt: Date;
  reason: string;
  nextAction: string;
  analysisSnapshotId?: string | null;
}) {
  const priorVersion = input.versionClock?.currentVersion ?? input.priorVersion;
  const resultingVersion = priorVersion + 1;
  if (input.versionClock) input.versionClock.currentVersion = resultingVersion;
  return {
    eventType: "CANONICAL_STAGE_TRANSITION",
    leadId: input.leadId,
    priorVersion,
    resultingVersion,
    priorStage: input.priorStage,
    resultingStage: input.nextStage,
    actor: input.actor,
    occurredAt: input.occurredAt.toISOString(),
    reason: input.reason,
    nextAction: input.nextAction,
    evidenceRefs: input.analysisSnapshotId ? [input.analysisSnapshotId] : [],
  };
}
