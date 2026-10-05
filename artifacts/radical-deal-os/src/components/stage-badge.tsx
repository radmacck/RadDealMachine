import { isDownstream, stageLabel, stageTone } from '@/lib/format';

export function StageBadge({ stage, variant = 'default' }: { stage: string; variant?: 'default' | 'field-desk' }) {
  return (
    <span className={variant === 'field-desk' ? 'fd-stage' : `tag ${stageTone(stage)}`} data-testid={`badge-stage-${stage}`} title={isDownstream(stage) ? 'Stage label only. This workflow is a later slice and is not built.' : undefined}>
      {stageLabel(stage)}
    </span>
  );
}
