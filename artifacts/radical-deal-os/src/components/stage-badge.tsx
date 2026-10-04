import { isDownstream, stageLabel, stageTone } from '@/lib/format';

export function StageBadge({ stage }: { stage: string }) {
  return (
    <span className={`tag ${stageTone(stage)}`} data-testid={`badge-stage-${stage}`} title={isDownstream(stage) ? 'Stage label only. This workflow is a later slice and is not built.' : undefined}>
      {stageLabel(stage)}
    </span>
  );
}
