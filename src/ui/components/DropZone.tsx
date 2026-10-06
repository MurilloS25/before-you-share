import { useRef, useState } from 'preact/hooks';
import { LIMITS, MiB } from '../../core/limits';

interface Props {
  onFile: (file: File, extra: number) => void;
  disabled?: boolean;
}

/** File intake: a real file input (keyboard and screen reader friendly) with drag and drop layered on top. */
export function DropZone({ onFile, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const take = (files: FileList | null | undefined) => {
    if (!files || files.length === 0) return;
    onFile(files[0]!, files.length - 1);
    if (input.current) input.current.value = '';
  };

  return (
    <section class="plate" aria-labelledby="intake-title" data-dragging={dragging || undefined}>
      <span class="plate-sheet plate-sheet-a" aria-hidden="true" />
      <span class="plate-sheet plate-sheet-b" aria-hidden="true" />
      <label
        class="dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) take(e.dataTransfer?.files);
        }}
      >
        <span class="corner corner-tl" aria-hidden="true" />
        <span class="corner corner-tr" aria-hidden="true" />
        <span class="corner corner-bl" aria-hidden="true" />
        <span class="corner corner-br" aria-hidden="true" />
        <span id="intake-title" class="dropzone-title">
          Drop a file on the plate
        </span>
        <span class="dropzone-or">or</span>
        <span class="button button-primary" aria-hidden="true">
          Choose a file
        </span>
        <input
          ref={input}
          class="file-input"
          type="file"
          disabled={disabled}
          aria-describedby="intake-note"
          aria-label="Choose a file to inspect"
          onChange={(e) => take((e.currentTarget as HTMLInputElement).files)}
        />
        <span id="intake-note" class="dropzone-note">
          JPEG, PNG or PDF. Images up to {LIMITS.maxFileBytes.jpeg / MiB} MiB, PDFs up to {LIMITS.maxFileBytes.pdf / MiB} MiB. The file is read in
          this browser tab and is never uploaded.
        </span>
      </label>
    </section>
  );
}
