import { CATEGORY_ORDER, type Category, type Finding } from '../../core/types';
import { CATEGORY_LABEL, formatBytes, plural } from '../lib/format';

interface Props {
  findings: Finding[];
  fileSize: number;
  activeId: string | null;
}

/**
 * A strip chart of the file: left is the first byte, right is the last. Each lane is one category and each
 * mark is a finding whose evidence is a byte range. It shows where hidden items sit relative to the picture or
 * document data. The list below carries the same information as text.
 */
export function FileMap({ findings, fileSize, activeId }: Props) {
  const located = findings.filter((f) => f.location.kind === 'bytes' && f.location.length > 0);
  const unlocated = findings.length - located.length;
  const lanes = CATEGORY_ORDER.filter((c) => located.some((f) => f.category === c));
  if (fileSize === 0 || lanes.length === 0) {
    return (
      <figure class="filemap filemap-empty">
        <figcaption>No finding is tied to a byte range, so there is nothing to place on the file map.</figcaption>
      </figure>
    );
  }
  return (
    <figure class="filemap">
      <figcaption>
        Where findings sit in the file. Left is the first byte, right is byte {fileSize.toLocaleString('en-US')} ({formatBytes(fileSize)}).
      </figcaption>
      <div class="filemap-lanes">
        {lanes.map((cat: Category) => (
          <div class="lane" key={cat}>
            <span class="lane-label">
              {CATEGORY_LABEL[cat]} <span class="count">{located.filter((f) => f.category === cat).length}</span>
            </span>
            <span class="lane-track" aria-hidden="true">
              {located
                .filter((f) => f.category === cat)
                .map((f) => {
                  const loc = f.location as { offset: number; length: number };
                  const left = Math.min(99.4, (loc.offset / fileSize) * 100);
                  const width = Math.max(0.6, Math.min(100 - left, (loc.length / fileSize) * 100));
                  return <span key={f.id} class="tick" data-status={f.status} data-active={f.id === activeId || undefined} style={{ left: `${left}%`, width: `${width}%` }} />;
                })}
            </span>
          </div>
        ))}
      </div>
      <p class="filemap-note">
        Solid marks were read directly from the file. Hatched marks are inferred, not supported or unavailable. Amber marks are unusual structure, which is not the same as harmful.
      </p>
      {unlocated > 0 && <p class="filemap-note">{plural(unlocated, 'finding')} not tied to a byte range {unlocated === 1 ? 'is' : 'are'} listed below but not drawn here.</p>}
    </figure>
  );
}
