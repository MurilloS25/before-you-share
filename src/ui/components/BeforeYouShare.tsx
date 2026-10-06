import { useMemo } from 'preact/hooks';
import type { AnalysisReport, RemovalGroup } from '../../core/types';
import { FORMAT_LABEL, formatBytes, plural } from '../lib/format';
import { lower, noteCountText, shareNotes } from '../lib/summary';

interface Props {
  report: AnalysisReport;
  name: string;
  groups: RemovalGroup[];
  selected: string[];
  busy: boolean;
  /** A copy has been built and is shown above. */
  copyDone: boolean;
  onCreate: () => void;
  onChoose: () => void;
  onOpenReport: (target?: string) => void;
  onDiscard: () => void;
  optionsOpen: boolean;
}

/**
 * The simple answer. It says which kinds of information the file carries and offers the next step, in plain words.
 * It summarises categories, never rates the file, and holds no selection of its own: the primary button uses the
 * recommended groups from the one canonical selection, and "Choose what to remove" reveals the one canonical panel.
 */
export function BeforeYouShare({ report, name, groups, selected, busy, copyDone, onCreate, onChoose, onOpenReport, onDiscard, optionsOpen }: Props) {
  const notes = useMemo(() => shareNotes(report.findings), [report]);
  const kinds = noteCountText(notes);
  const image = report.format === 'jpeg' || report.format === 'png';
  const canCopy = image && groups.length > 0 && !report.copyRefusal;
  const kind = report.format === 'pdf' ? 'PDF' : 'DOCX';
  const notRead = report.coverage.filter((c) => c.state !== 'inspected').length;
  const chosen = groups.filter((g) => selected.includes(g.id));
  const asRecommended = groups.every((g) => selected.includes(g.id) === g.defaultOn);
  const notChosen = groups.length - chosen.length;

  return (
    <section class="before-share" aria-labelledby="before-share-h" id="before-share">
      <h2 id="before-share-h" class="section-title" tabIndex={-1}>
        Before you share
      </h2>
      <p class="file-line">
        <strong class="user-text">{name}</strong> <span>{FORMAT_LABEL[report.format]}, {formatBytes(report.fingerprint.size)}</span>
      </p>
      {notes.length === 0 ? (
        <p class="section-lead">Nothing notable was found in the areas this tool reads. That does not mean the file has no hidden information.</p>
      ) : (
        <>
          <p class="section-lead">
            {kinds ? `${kinds} Common data is not automatically a problem, and other hidden information may remain.` : 'Parts of this file could not be read or examined in full. Other hidden information may remain.'}
          </p>
          <ul class="share-list">
            {notes.map((n) => (
              <li key={n.id} data-category={n.category}>
                <strong>{n.headline}</strong> <span class="count">{plural(n.count, 'finding')}</span>
                <span class="share-detail">{n.detail}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {notRead > 0 && (
        <p class="coverage-line">
          {plural(notRead, 'area')} {notRead === 1 ? 'was' : 'were'} only partly checked or not checked.{' '}
          <button type="button" class="link-button" onClick={() => onOpenReport('coverage-h')}>
            See what was not checked
          </button>
        </p>
      )}

      <div class="share-actions">
        {canCopy && !copyDone && (
          <>
            <p class="recommend">
              {chosen.length > 0 ? (
                <>
                  {asRecommended ? 'Recommended removal' : 'Selected for removal'}: {chosen.map((g) => lower(g.label)).join(', ')}.{' '}
                  {notChosen > 0 && `${plural(notChosen, 'other kind')} of data this tool can remove ${notChosen === 1 ? 'is' : 'are'} not selected; see "Choose what to remove". `}This is an
                  experimental copy: your original is not changed, other hidden information may remain, and nothing is downloaded until you choose to.
                </>
              ) : (
                'Nothing is selected for removal. Choose what to remove to make a copy.'
              )}
            </p>
            <div class="share-buttons">
              <button type="button" id="create-copy" class="button button-primary" disabled={busy || chosen.length === 0} onClick={onCreate}>
                Create experimental copy
              </button>
              <button type="button" class="button" disabled={busy} aria-expanded={optionsOpen} aria-controls={optionsOpen ? 'copy-section' : undefined} onClick={onChoose}>
                Choose what to remove
              </button>
              <button type="button" class="button" onClick={() => onOpenReport()}>
                View full technical report
              </button>
            </div>
          </>
        )}
        {canCopy && copyDone && (
          <>
            <p class="recommend">The experimental copy is shown above. Your original is not changed.</p>
            <div class="share-buttons">
              <button type="button" class="button" disabled={busy} onClick={onDiscard}>
                Change what to remove
              </button>
              <button type="button" class="button" onClick={() => onOpenReport()}>
                View full technical report
              </button>
            </div>
          </>
        )}
        {!canCopy && (
          <>
            {report.format === 'pdf' || report.format === 'docx' ? (
              <p class="recommend">
                This tool can only inspect {kind} files. It does not offer a modified copy. To share fewer details, use the program that created the file, then
                inspect the result here.
              </p>
            ) : report.copyRefusal ? (
              <p class="recommend">No copy is offered for this file. {report.copyRefusal}</p>
            ) : (
              <p class="recommend">Nothing that this tool can remove was found, so there is no copy to make. Other hidden information may still be present.</p>
            )}
            <div class="share-buttons">
              <button type="button" class="button button-primary" onClick={() => onOpenReport()}>
                View full technical report
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
