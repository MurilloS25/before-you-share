import type { JobStage } from '../../worker/protocol';

const STAGE_TEXT: Record<JobStage, string> = {
  reading: 'Reading the file in this browser',
  inspecting: 'Inspecting structure and metadata',
  'building-copy': 'Building the experimental copy',
  verifying: 'Re-inspecting the copy and comparing it with the original',
  rendering: 'Drawing page 1 as an inert picture',
};

interface Props {
  stage: JobStage;
  fraction: number | null;
  onCancel: () => void;
  label?: string;
}

/** Announces progress politely and offers cancellation. The scan line animation only decorates; the text carries the meaning. */
export function Progress({ stage, fraction, onCancel, label }: Props) {
  const pct = fraction === null ? null : Math.round(fraction * 100);
  return (
    <section class="working" aria-busy="true">
      <div class="scanline" aria-hidden="true" />
      <p role="status" class="working-text">
        {label ? `${label}: ` : ''}
        {STAGE_TEXT[stage]}…
      </p>
      {pct !== null && <p class="working-pct">{pct}%</p>}
      {pct !== null ? <progress max={100} value={pct} aria-label={STAGE_TEXT[stage]} /> : <progress aria-label={STAGE_TEXT[stage]} />}
      <button type="button" class="button" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}
