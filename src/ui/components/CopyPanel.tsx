import type { AnalysisReport, RemovalGroup } from '../../core/types';
import { POLICY, remainingAfter, removedBy } from '../../transform/policy';
import { CATEGORY_LABEL, plural } from '../lib/format';
import type { Category } from '../../core/types';

interface Props {
  report: AnalysisReport;
  groups: RemovalGroup[];
  selected: string[];
  onToggle: (id: string) => void;
  onCreate: () => void;
  busy: boolean;
}

export function CopyPanel({ report, groups, selected, onToggle, onCreate, busy }: Props) {
  if (report.format === 'pdf' || report.format === 'docx') {
    const pdf = report.format === 'pdf';
    return (
      <section class="copy-panel" aria-labelledby="copy-h">
        <h2 id="copy-h" class="section-title">
          Experimental copy
        </h2>
        <p>
          {pdf
            ? 'Copies are not offered for PDF files. A PDF can keep earlier versions, compressed objects and structures that this tool cannot rewrite and then verify, so it only inspects them.'
            : 'Copies are not offered for DOCX files. A Word document keeps comments, tracked changes, revision data and embedded parts that this tool cannot rewrite and then verify, so it only inspects them.'}{' '}
          To share {pdf ? 'a PDF' : 'a document'} with fewer details, use the program that created it and check the result with this tool.
        </p>
      </section>
    );
  }
  if (report.copyRefusal) {
    return (
      <section class="copy-panel" aria-labelledby="copy-h">
        <h2 id="copy-h" class="section-title">
          Experimental copy
        </h2>
        <p>No copy is offered for this file. {report.copyRefusal}</p>
        <p class="fine-print">Your original is untouched.</p>
      </section>
    );
  }
  if (groups.length === 0) {
    return (
      <section class="copy-panel" aria-labelledby="copy-h">
        <h2 id="copy-h" class="section-title">
          Experimental copy
        </h2>
        <p>Nothing that this tool can remove was found, so there is nothing to change. Other hidden information may still be present.</p>
      </section>
    );
  }
  const format = report.format;
  const removing = removedBy(report, selected);
  const staying = remainingAfter(report, selected);
  const stayingByCat = new Map<Category, number>();
  for (const f of staying) stayingByCat.set(f.category, (stayingByCat.get(f.category) ?? 0) + 1);
  return (
    <section class="copy-panel" aria-labelledby="copy-h">
      <h2 id="copy-h" class="section-title">
        Experimental copy
      </h2>
      <p class="section-lead">
        This builds a new file in memory from the original. Your original is never changed, and nothing is downloaded until you choose to.
      </p>
      <fieldset class="options" disabled={busy}>
        <legend>Choose what to remove from the copy</legend>
        {groups.map((g) => (
          <label class="option" key={g.id}>
            <input type="checkbox" checked={selected.includes(g.id)} onChange={() => onToggle(g.id)} />
            <span class="option-text">
              <span class="option-label">
                {g.label} <span class="count">{g.findingCount}</span>
              </span>
              <span class="option-desc">{g.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div class="plan">
        <div>
          <h3 class="plan-title">Will be removed</h3>
          <p>{removing.length === 0 ? 'Nothing is selected.' : `${plural(removing.length, 'finding')} from the list above.`}</p>
        </div>
        <div>
          <h3 class="plan-title">Will stay in the copy</h3>
          <p>
            {staying.length === 0
              ? 'No other findings from the list above.'
              : `${plural(staying.length, 'finding')}: ${[...stayingByCat.entries()].map(([c, n]) => `${CATEGORY_LABEL[c].toLowerCase()} (${n})`).join(', ')}.`}
          </p>
        </div>
      </div>
      <div class="plan-more">
        <h3 class="plan-title">Always kept</h3>
        <ul class="plain-list bullet">
          {POLICY[format].preserved.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <h3 class="plan-title">May change</h3>
        <ul class="plain-list bullet">
          {POLICY[format].mayChange.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p class="fine-print">
          The copy is named after the original file name with ".experimental-copy" added, so the stem of the name is kept. Rename it if the name itself is
          sensitive. Other hidden information may remain after any removal. Open and check the copy before sharing it.
        </p>
      </div>
      <button type="button" id="make-copy" class="button button-primary" disabled={busy || selected.length === 0} onClick={onCreate}>
        Make experimental copy
      </button>
    </section>
  );
}
