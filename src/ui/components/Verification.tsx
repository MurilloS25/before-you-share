import { useState } from 'preact/hooks';
import type { AnalysisReport, Finding, MutationManifest, VerificationResult } from '../../core/types';
import { formatBytes, plural } from '../lib/format';
import { LazyDetails, ShowMore } from './Disclosure';

export interface CopyResult {
  url: string;
  size: number;
  downloadName: string;
  manifest: MutationManifest;
  verification: VerificationResult;
}

interface Props {
  report: AnalysisReport;
  originalUrl: string | null;
  copy: CopyResult;
  onDownload: () => void;
}

const CHECK_TEXT = { pass: 'Passed', fail: 'Did not pass', skipped: 'Skipped' } as const;

function Preview({ url, label, dims }: { url: string | null; label: string; dims: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure class="compare-item">
      <div class="compare-frame">
        {url && !failed ? (
          <img src={url} alt={`${label}, shown as the browser displays it`} onError={() => setFailed(true)} decoding="async" />
        ) : (
          <p class="compare-missing">{failed ? 'The browser could not display this image.' : 'Preview not shown for this file.'}</p>
        )}
      </div>
      <figcaption>
        {label}
        <span class="fine-print"> {dims}</span>
      </figcaption>
    </figure>
  );
}

const notable = (list: Finding[]): Finding[] => list.filter((f) => f.category !== 'structural');

export function VerificationView({ report, originalUrl, copy, onDownload }: Props) {
  const v = copy.verification;
  const failed = v.checks.filter((c) => c.status === 'fail');
  const removed = notable(v.removedFindings);
  const remaining = notable(v.remainingFindings);
  const dims = (r: AnalysisReport) => (r.dimensions ? `${r.dimensions.width} × ${r.dimensions.height} px` : 'unknown size');
  const count = (r: AnalysisReport) => notable(r.findings).length;
  return (
    <section class="verification" aria-labelledby="verify-h" tabIndex={-1} id="verification">
      <h2 id="verify-h" class="section-title" tabIndex={-1}>
        Experimental copy, re-inspected
      </h2>
      {v.allPassed ? (
        <p class="verdict" data-ok="true">
          The copy was inspected again and {plural(v.checks.filter((c) => c.status === 'pass').length, 'check')} passed
          {v.checks.some((c) => c.status === 'skipped') ? `, ${v.checks.filter((c) => c.status === 'skipped').length} skipped (marked below)` : ''}. The selected fields were no
          longer detected. Other hidden information may remain.
        </p>
      ) : (
        <p class="verdict" role="alert" data-ok="false">
          {plural(failed.length, 'check')} did not pass: {failed.map((c) => c.label.toLowerCase()).join('; ')}. Do not use this copy. Your original is untouched. Change the selection and try again, or clear and start over.
        </p>
      )}

      <div class="compare">
        <Preview url={originalUrl} label="Original" dims={`${dims(report)}, ${formatBytes(report.fingerprint.size)}`} />
        <Preview url={copy.url} label="Experimental copy" dims={`${dims(v.copyReport)}, ${formatBytes(copy.size)}`} />
      </div>

      <div class="download">
        <p>
          The copy will be saved as <strong class="user-text">{copy.downloadName}</strong>, a new file. Your original is not replaced or changed. Open and check
          this copy before sharing it, and keep your original. This tool is experimental and cannot promise the copy is free of hidden information.
        </p>
        {!v.allPassed && <p class="fine-print">Download is disabled because a check did not pass.</p>}
        <button type="button" class="button button-primary" onClick={onDownload} disabled={!v.allPassed}>
          Download experimental copy
        </button>
      </div>

      <div class="delta">
        <div>
          <h3 class="subhead">No longer detected ({removed.length})</h3>
          {removed.length === 0 ? (
            <p class="fine-print">None.</p>
          ) : (
            <ShowMore
              items={removed}
              id="list-removed"
              listClass="plain-list bullet"
              noun={['finding', 'findings']}
              threshold={8}
              initial={6}
              render={(f) => (
                <li key={f.id}>
                  {f.label}
                  {f.value ? <span class="user-text">: {f.value}</span> : null}
                </li>
              )}
            />
          )}
        </div>
        <div>
          <h3 class="subhead">Still detected ({remaining.length})</h3>
          {remaining.length === 0 ? (
            <p class="fine-print">None of the fields this tool reads.</p>
          ) : (
            <ShowMore
              items={remaining}
              id="list-remaining"
              listClass="plain-list bullet"
              noun={['finding', 'findings']}
              threshold={8}
              initial={6}
              render={(f) => (
                <li key={f.id}>
                  {f.label}
                  {f.value ? <span class="user-text">: {f.value}</span> : null}
                </li>
              )}
            />
          )}
        </div>
      </div>
      {v.newFindings.length > 0 && <p class="verdict" data-ok="false">The copy contains {plural(v.newFindings.length, 'finding')} that were not in the original.</p>}

      <LazyDetails class="tech-details" summary={`All ${v.checks.length} verification checks (${v.checks.filter((c) => c.status === 'pass').length} passed)`} open={failed.length > 0}>
        <ul class="checks">
          {v.checks.map((c) => (
            <li key={c.id} data-status={c.status}>
              <span class="check-status">{CHECK_TEXT[c.status]}</span>
              <span class="check-label">{c.label}</span>
              <span class="check-detail">{c.detail}</span>
            </li>
          ))}
        </ul>
        <table class="compare-table">
          <caption>Original and experimental copy compared</caption>
          <thead>
            <tr>
              <th scope="col">Property</th>
              <th scope="col">Original</th>
              <th scope="col">Copy</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">File size</th>
              <td>{formatBytes(report.fingerprint.size)}</td>
              <td>{formatBytes(copy.size)}</td>
            </tr>
            <tr>
              <th scope="row">Dimensions</th>
              <td>{dims(report)}</td>
              <td>{dims(v.copyReport)}</td>
            </tr>
            <tr>
              <th scope="row">Orientation value</th>
              <td>{report.orientation ?? 'None'}</td>
              <td>{v.copyReport.orientation ?? 'None'}</td>
            </tr>
            <tr>
              <th scope="row">Findings outside structure</th>
              <td>{count(report)}</td>
              <td>{count(v.copyReport)}</td>
            </tr>
          </tbody>
        </table>
      </LazyDetails>

      <LazyDetails class="manifest" summary={`Mutation manifest (${plural(copy.manifest.entries.length, 'entry', 'entries')})`}>
        <div class="table-scroll" tabIndex={0} role="region" aria-label="Mutation manifest table, scrolls sideways on narrow screens">
        <table>
          <caption>Every change and every deliberate non-change, by byte range in the original</caption>
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">What</th>
              <th scope="col">Starts at byte</th>
              <th scope="col">Bytes</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {copy.manifest.entries.map((e, i) => (
              <tr key={i}>
                <td>{e.action}</td>
                <td>{e.what}</td>
                <td>{e.offset === null ? '' : e.offset.toLocaleString('en-US')}</td>
                <td>{e.bytes.toLocaleString('en-US')}</td>
                <td>{e.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </LazyDetails>
    </section>
  );
}
