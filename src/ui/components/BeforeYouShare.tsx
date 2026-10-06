import { useMemo } from 'preact/hooks';
import type { AnalysisReport, RemovalGroup } from '../../core/types';
import { plural } from '../lib/format';
import { goTo } from '../lib/nav';
import { lower, noteCountText, shareNotes } from '../lib/summary';

interface Props {
  report: AnalysisReport;
  groups: RemovalGroup[];
}

/**
 * The first answer: which kinds of information the file carries and what can be done about it, in plain words.
 * It summarises categories, links to the evidence, and points at the single canonical copy panel; it never
 * holds a second copy of the selection and never rates the file.
 */
export function BeforeYouShare({ report, groups }: Props) {
  const notes = useMemo(() => shareNotes(report.findings), [report]);
  const kinds = noteCountText(notes);
  const image = report.format === 'jpeg' || report.format === 'png';
  const canCopy = image && groups.length > 0;
  const kind = report.format === 'pdf' ? 'PDF' : 'DOCX';

  return (
    <section class="before-share" aria-labelledby="before-share-h" id="before-share">
      <h2 id="before-share-h" class="section-title">
        Before you share
      </h2>
      {notes.length === 0 ? (
        <p class="section-lead">
          Nothing notable was found in the areas this tool reads. That does not mean the file has no hidden information: see what was not checked.
        </p>
      ) : (
        <p class="section-lead">
          {kinds ? `${kinds} Common data is not automatically a problem, and other hidden information may remain.` : 'Parts of this file could not be read or examined in full, listed below. Other hidden information may remain.'}
        </p>
      )}

      <div class="share-actions">
        {canCopy ? (
          <>
            <p>
              An experimental copy can leave out: {groups.map((g) => lower(g.label)).join(', ')}. Your original is not changed, and nothing is downloaded
              until you choose to.
            </p>
            <div class="share-buttons">
              <button type="button" class="button button-primary" onClick={() => goTo('copy-h')}>
                Review copy options
              </button>
              <button type="button" class="button" onClick={() => goTo('findings-h')}>
                Review all findings
              </button>
              <button type="button" class="button" onClick={() => goTo('coverage-h')}>
                What was not checked
              </button>
            </div>
          </>
        ) : (
          <>
            {report.format === 'pdf' || report.format === 'docx' ? (
              <p>
                This tool can only inspect {kind} files. It does not offer a modified copy. To share fewer details, use the program that created the file,
                then inspect the result here.
              </p>
            ) : report.copyRefusal ? (
              <p>No copy is offered for this file. The reason is given in the copy section below.</p>
            ) : (
              <p>Nothing that this tool can remove was found, so there is no copy to make.</p>
            )}
            <div class="share-buttons">
              <button type="button" class="button" onClick={() => goTo('findings-h')}>
                Review all findings
              </button>
              <button type="button" class="button" onClick={() => goTo('coverage-h')}>
                What was not checked
              </button>
            </div>
          </>
        )}
      </div>

      {notes.length > 0 && (
          <ul class="share-notes">
            {notes.map((n) => (
              <li key={n.id} data-category={n.category}>
                <p class="share-headline">
                  <strong>{n.headline}</strong> <span class="count">{plural(n.count, 'finding')}</span>
                </p>
                <p class="share-detail">{n.detail}</p>
                <button type="button" class="link-button" onClick={() => goTo(`cat-h-${n.category}`)}>
                  See the findings: {lower(n.headline)}
                </button>
              </li>
            ))}
          </ul>
      )}
    </section>
  );
}
