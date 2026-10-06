import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LIMITS } from '../core/limits';
import type { StructuredError } from '../core/errors';
import type { Detection } from '../core/detect';
import type { AnalysisReport, Fingerprint } from '../core/types';
import { imageSizeRefusal } from '../formats/common';
import { removalGroupsFor } from '../transform/groups';
import type { AnalysisClient } from '../worker/client';
import type { JobStage } from '../worker/protocol';
import { DropZone } from './components/DropZone';
import { Progress } from './components/Progress';
import { Identification } from './components/Identification';
import { FileMap } from './components/FileMap';
import { CoverageList, FindingsByCategory } from './components/Findings';
import { CopyPanel } from './components/CopyPanel';
import { BeforeYouShare } from './components/BeforeYouShare';
import { LazyDetails } from './components/Disclosure';
import { VerificationView, type CopyResult } from './components/Verification';
import { downloadName, formatBytes, isImageFormat, plural, STATUS_HELP, STATUS_LABEL } from './lib/format';
import { MIME, ObjectUrlRegistry } from './lib/urls';

interface Props {
  client: AnalysisClient;
  urls?: ObjectUrlRegistry;
}

type PdfPreview = { state: 'none' } | { state: 'loading' } | { state: 'ready'; url: string } | { state: 'error'; message: string };
type CopyState = { kind: 'idle' } | { kind: 'building'; stage: JobStage } | { kind: 'done'; result: CopyResult } | { kind: 'error'; error: StructuredError };

type View =
  | { kind: 'idle'; notice?: string }
  | { kind: 'working'; stage: JobStage; fraction: number | null }
  | { kind: 'error'; error: StructuredError }
  | { kind: 'unsupported'; name: string; fingerprint: Fingerprint; detection: Detection }
  | { kind: 'result'; name: string; report: AnalysisReport; originalUrl: string | null; pdfPreview: PdfPreview; selected: string[]; copy: CopyState; extraFiles: number };

const ERROR_TITLE: Record<StructuredError['code'], string> = {
  'file-too-large': 'This file is too large',
  'file-empty': 'This file is empty',
  'unsupported-format': 'This format is not supported',
  'limit-exceeded': 'A safety limit was reached',
  malformed: 'The file could not be read',
  cancelled: 'Cancelled',
  timeout: 'The job took too long',
  'worker-failure': 'Something went wrong',
  'read-failed': 'The file could not be read',
  refused: 'This could not be done',
};

export function App({ client, urls: urlsProp }: Props) {
  const urls = useMemo(() => urlsProp ?? new ObjectUrlRegistry(), [urlsProp]);
  const [view, setView] = useState<View>({ kind: 'idle' });
  const run = useRef(0);
  const file = useRef<File | null>(null);
  const [announce, setAnnounce] = useState('');

  // Leaving the page or unmounting releases the worker and every object URL.
  useEffect(
    () => () => {
      client.dispose();
      urls.clear();
    },
    [client, urls],
  );

  // Move focus to the page heading whenever the screen changes, so keyboard and screen reader users start at the new content.
  useEffect(() => {
    if (view.kind !== 'idle') document.querySelector<HTMLElement>('main h1')?.focus();
  }, [view.kind]);

  // A file dropped anywhere outside the plate must never be opened by the browser itself (that would render it natively).
  // On the start screen a drop anywhere is taken as intake; elsewhere it is ignored.
  const viewKind = useRef(view.kind);
  viewKind.current = view.kind;
  const openRef = useRef<(f: File, extra: number) => void>(() => undefined);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (viewKind.current === 'idle' && files && files.length > 0 && !(e.target as HTMLElement | null)?.closest?.('.dropzone')) openRef.current(files[0]!, files.length - 1);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const reset = (notice?: string) => {
    run.current++;
    client.dispose();
    urls.clear();
    file.current = null;
    setAnnounce(notice ?? 'Cleared. No file or result is kept in this tab.');
    setView({ kind: 'idle', notice });
    queueMicrotask(() => document.querySelector<HTMLInputElement>('.file-input')?.focus());
  };

  const open = async (f: File, extra: number) => {
    const token = ++run.current;
    urls.clear();
    file.current = f;
    // Cheap checks first, before any worker is involved.
    if (f.size === 0) return setView({ kind: 'error', error: { code: 'file-empty', message: 'The file has no content, so there is nothing to inspect.' } });
    if (f.size > LIMITS.maxAnyFileBytes) {
      return setView({ kind: 'error', error: { code: 'file-too-large', message: `This file is ${formatBytes(f.size)}. This tool reads files up to ${formatBytes(LIMITS.maxAnyFileBytes)} (images up to ${formatBytes(LIMITS.maxFileBytes.jpeg)}).` } });
    }
    setView({ kind: 'working', stage: 'reading', fraction: 0 });
    setAnnounce('');
    const job = client.analyse(f, { onProgress: (stage, fraction) => run.current === token && setView({ kind: 'working', stage, fraction }) });
    const out = await job.promise;
    if (run.current !== token) return; // superseded, cancelled or reset: ignore
    if (!out.ok) {
      if (out.error.code === 'cancelled') return;
      setAnnounce(ERROR_TITLE[out.error.code]);
      return setView({ kind: 'error', error: out.error });
    }
    const p = out.payload;
    if (p.kind !== 'analysis') return;
    if (!p.supported) {
      setAnnounce('This format is not supported.');
      return setView({ kind: 'unsupported', name: f.name, fingerprint: p.fingerprint, detection: p.detection });
    }
    const report = p.report;
    let originalUrl: string | null = null;
    if (isImageFormat(report.format) && report.dimensions !== null && imageSizeRefusal(report.dimensions) === null && !report.structurallyUnsound) {
      // The slice carries a MIME type we choose, never the one the file declared.
      originalUrl = urls.create(f.slice(0, f.size, MIME[report.format]));
    }
    const groups = removalGroupsFor(report);
    setAnnounce(`Inspection finished. ${plural(report.findings.length, 'finding')}.`);
    setView({ kind: 'result', name: f.name, report, originalUrl, pdfPreview: { state: 'none' }, selected: groups.filter((g) => g.defaultOn).map((g) => g.id), copy: { kind: 'idle' }, extraFiles: extra });
  };

  openRef.current = (f, extra) => void open(f, extra);

  const cancel = () => {
    run.current++;
    client.cancel();
    reset('Cancelled. Nothing was kept.');
  };

  /** A cancelled or failed job ends the worker. Re-read the file (still selected in this tab) instead of leaving a dead end. */
  const ensureSession = async (token: number, expectedSha: string | null): Promise<boolean> => {
    if (client.sessionOpen) return true;
    const f = file.current;
    if (!f) return false;
    const out = await client.analyse(f).promise;
    if (run.current !== token || !out.ok || out.payload.kind !== 'analysis' || !out.payload.supported) return false;
    // The file is read again from disk: refuse if it is no longer the file whose report is on screen.
    return expectedSha === null || out.payload.report.fingerprint.sha256 === expectedSha;
  };

  const makeCopy = async () => {
    if (view.kind !== 'result') return;
    const token = ++run.current;
    const base = view;
    if (base.copy.kind === 'done') urls.revoke(base.copy.result.url);
    setView({ ...base, copy: { kind: 'building', stage: 'building-copy' } });
    if (!(await ensureSession(token, base.report.fingerprint.sha256))) {
      if (run.current !== token) return;
      return setView({ ...base, copy: { kind: 'error', error: { code: 'worker-failure', message: 'The file could not be read again, or it changed on disk. Use "Clear and start over" and choose it again.' } } });
    }
    const job = client.transform(base.selected, { onProgress: (stage) => run.current === token && setView((v) => (v.kind === 'result' ? { ...v, copy: { kind: 'building', stage } } : v)) });
    const out = await job.promise;
    if (run.current !== token) return;
    if (!out.ok) {
      if (out.error.code === 'cancelled') return;
      // A failed or timed-out copy ends the worker; the report on screen stays valid but a new copy needs the file again.
      return setView({ ...base, copy: { kind: 'error', error: out.error } });
    }
    const p = out.payload;
    if (p.kind !== 'transform' || !isImageFormat(base.report.format)) return;
    const blob = new Blob([p.output], { type: MIME[base.report.format] });
    const url = urls.create(blob);
    setAnnounce('The experimental copy was built and re-inspected.');
    setView({
      ...base,
      copy: { kind: 'done', result: { url, size: blob.size, downloadName: downloadName(base.name, base.report.format), manifest: p.manifest, verification: p.verification } },
    });
    queueMicrotask(() => document.getElementById('verify-h')?.focus());
  };

  const cancelCopy = () => {
    run.current++;
    client.cancel();
    if (view.kind === 'result') setView({ ...view, copy: { kind: 'idle' } });
    setAnnounce('The copy was cancelled. The inspection result is still shown; you can make a copy again.');
    queueMicrotask(() => document.getElementById('make-copy')?.focus());
  };

  const toggleGroup = (id: string) => {
    if (view.kind !== 'result') return;
    if (view.copy.kind === 'done') {
      urls.revoke(view.copy.result.url);
      setAnnounce('The selection changed, so the previous copy was discarded. Make a new copy to check it.');
    }
    setView({ ...view, selected: view.selected.includes(id) ? view.selected.filter((x) => x !== id) : [...view.selected, id], copy: { kind: 'idle' } });
  };

  const download = () => {
    if (view.kind !== 'result' || view.copy.kind !== 'done') return;
    const a = document.createElement('a');
    a.href = view.copy.result.url;
    a.download = view.copy.result.downloadName;
    a.rel = 'noopener';
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
  };

  const showPdfPreview = async () => {
    if (view.kind !== 'result') return;
    const token = ++run.current;
    const base = view;
    if (base.pdfPreview.state === 'ready') urls.revoke(base.pdfPreview.url);
    setView({ ...base, pdfPreview: { state: 'loading' } });
    if (!(await ensureSession(token, base.report.fingerprint.sha256))) {
      if (run.current !== token) return;
      return setView({ ...base, pdfPreview: { state: 'error', message: 'The file could not be read again, or it changed on disk. Use "Clear and start over" and choose it again.' } });
    }
    const job = client.previewPdf();
    const out = await job.promise;
    if (run.current !== token) return;
    if (!out.ok) {
      if (out.error.code === 'cancelled') return;
      return setView({ ...base, pdfPreview: { state: 'error', message: out.error.message } });
    }
    if (out.payload.kind !== 'pdf-preview') return;
    const url = urls.create(new Blob([out.payload.png], { type: 'image/png' }));
    setView({ ...base, pdfPreview: { state: 'ready', url } });
  };

  const busy = view.kind === 'working' || (view.kind === 'result' && (view.copy.kind === 'building' || view.pdfPreview.state === 'loading'));

  return (
    <div class="app">
      <header class="masthead">
        <p class="wordmark">Before You Share</p>
        <p class="masthead-note">Experimental. Runs in this browser tab.</p>
        {view.kind !== 'idle' && (
          <button type="button" class="button button-quiet" onClick={() => reset()}>
            Clear and start over
          </button>
        )}
      </header>

      <main id="main" class={view.kind === 'idle' ? 'main-idle' : undefined}>
        <p class="visually-hidden" role="status" aria-live="polite" data-testid="announce">
          {announce}
        </p>

        {view.kind === 'idle' && (
          <>
            <section class="hero" aria-labelledby="hero-title">
              <h1 id="hero-title" class="hero-title">
                See what a file may reveal before you share it.
              </h1>
              <p class="hero-lead">
                Photos and documents often carry more than what is on screen: where a picture was taken, which device made it, who is named as the author,
                what an earlier version said. This tool lists what it can find, shows where each item sits in the file, and says plainly what it could not check.
              </p>
              <p class="local-note">
                <strong>Your file stays here.</strong> It is read inside this browser tab. There is no upload, no account and no analytics, and the page is built
                to refuse network connections when it is served with its security headers.
              </p>
            </section>
            {view.notice && <p class="notice">{view.notice}</p>}
            <DropZone onFile={open} />
            <Limits />
          </>
        )}

        {view.kind === 'working' && (
          <>
            <h1 class="page-title" tabIndex={-1}>Inspecting</h1>
            <Progress stage={view.stage} fraction={view.fraction} onCancel={cancel} />
          </>
        )}

        {view.kind === 'error' && (
          <section class="error" role="alert" aria-labelledby="err-h">
            <h1 id="err-h" class="page-title" tabIndex={-1}>
              {ERROR_TITLE[view.error.code]}
            </h1>
            <p>{view.error.message}</p>
            <p class="fine-print">Your original file was not changed, and nothing was kept.</p>
            <button type="button" class="button button-primary" onClick={() => reset()}>
              Choose another file
            </button>
          </section>
        )}

        {view.kind === 'unsupported' && (
          <>
            <h1 class="page-title" tabIndex={-1}>
              This format is not supported
            </h1>
            <p class="section-lead">
              The content looks like <strong>{view.detection.label}</strong>
              {view.detection.recognisedUnsupported ? ', which this tool does not inspect' : ', which this tool does not recognise'}. It inspects JPEG, PNG, PDF and DOCX. It does
              not guess, so nothing has been listed about this file.
            </p>
            <Identification name={view.name} fingerprint={view.fingerprint} detection={view.detection} />
            <p class="fine-print">The SHA-256 is not computed for unsupported files, because the rest of the file is not read.</p>
            <button type="button" class="button button-primary" onClick={() => reset()}>
              Choose another file
            </button>
          </>
        )}

        {view.kind === 'result' && <ResultView view={view} busy={busy} setView={setView} actions={{ makeCopy, cancelCopy, download, showPdfPreview, reset, toggleGroup }} />}
      </main>

      <footer class="footer">
        <p>
          Before You Share is experimental. It is not antivirus, forensic or legal software and cannot guarantee that a file is anonymous, safe or free of
          hidden information.
        </p>
      </footer>
    </div>
  );
}

function Limits() {
  return (
    <section class="limits" aria-labelledby="limits-h">
      <h2 id="limits-h" class="section-title">
        What to expect
      </h2>
      <ul class="plain-list bullet">
        <li>It reads JPEG, PNG, PDF and DOCX by their content, not their name.</li>
        <li>For JPEG and PNG it can make a separate experimental copy with chosen metadata removed, then inspect the copy again and compare it.</li>
        <li>PDFs and Word documents are inspected only. Page text and images are not analysed, and encrypted PDFs are not opened.</li>
        <li>Nothing is complete. It lists what it could not check, and other hidden information may remain.</li>
      </ul>
    </section>
  );
}

interface ResultProps {
  view: Extract<View, { kind: 'result' }>;
  busy: boolean;
  setView: (v: View) => void;
  actions: { makeCopy: () => void; cancelCopy: () => void; download: () => void; showPdfPreview: () => void; reset: () => void; toggleGroup: (id: string) => void };
}

function ResultView({ view, busy, setView, actions }: ResultProps) {
  const { report } = view;
  const [activeId, setActiveId] = useState<string | null>(null);
  const groups = removalGroupsFor(report);
  const notable = report.findings.filter((f) => f.category !== 'structural');
  const notRead = report.coverage.filter((c) => c.state !== 'inspected').length;

  return (
    <>
      <h1 class="page-title" tabIndex={-1}>
        Inspection result
      </h1>
      {view.extraFiles > 0 && <p class="notice">Only the first file was opened. Choose the others one at a time.</p>}
      <p class="summary">
        {notable.length === 0
          ? 'Nothing notable was found in the areas this tool reads.'
          : `${plural(notable.length, 'item')} found, grouped below by kind.`}{' '}
        {notRead > 0 ? `${plural(notRead, 'area')} could not be fully checked; see “What this tool did not fully check”.` : ''}
      </p>

      <Identification name={view.name} fingerprint={report.fingerprint} report={report} />

      <BeforeYouShare report={report} groups={groups} />

      {report.format === 'pdf' ? (
        <PdfPreviewBox state={view.pdfPreview} onShow={actions.showPdfPreview} busy={busy} />
      ) : report.format === 'docx' ? (
        <p class="fine-print">No preview is shown for Word documents. The tool does not render them.</p>
      ) : (
        view.originalUrl ? (
          <figure class="original-preview">
            <img src={view.originalUrl} alt="The file as the browser displays it" decoding="async" />
            <figcaption class="fine-print">Shown as an ordinary image, read from the file you selected in this tab. It is not uploaded.</figcaption>
          </figure>
        ) : (
          <p class="fine-print">No preview is shown{report.structurallyUnsound ? ' because the file structure is damaged' : ' because the declared size is above what this tool decodes'}.</p>
        )
      )}

      <section aria-labelledby="findings-h" class="findings-section">
        <h2 id="findings-h" class="section-title">
          Findings
        </h2>
        <p class="legend">
          Each finding says where it was read from and how sure the tool is. <em>Suspicious</em> means unusual or inconsistent, not harmful. Open “Evidence and limits” on any item for the location and caveats.
        </p>
        <details class="tech-details">
          <summary>How to read the status labels</summary>
          <dl class="status-legend">
            {(['verified', 'inferred', 'suspicious', 'unsupported', 'unavailable'] as const).map((s) => (
              <div key={s}>
                <dt>{STATUS_LABEL[s]}</dt>
                <dd>{STATUS_HELP[s]}</dd>
              </div>
            ))}
          </dl>
        </details>
        <LazyDetails class="tech-details" summary="Where findings sit in the file (map of byte positions)">
          <FileMap findings={report.findings} fileSize={report.fingerprint.size} activeId={activeId} />
        </LazyDetails>
        <FindingsByCategory findings={report.findings} activeId={activeId} onActive={setActiveId} />
      </section>

      <CoverageList coverage={report.coverage} />

      {view.copy.kind === 'building' ? (
        <Progress stage={view.copy.stage} fraction={null} onCancel={actions.cancelCopy} label="Experimental copy" />
      ) : (
        <CopyPanel report={report} groups={groups} selected={view.selected} onToggle={actions.toggleGroup} onCreate={actions.makeCopy} busy={busy} />
      )}
      {view.copy.kind === 'error' && (
        <p class="error" role="alert">
          {ERROR_TITLE[view.copy.error.code]}: {view.copy.error.message} Your original is untouched.{' '}
          {view.copy.error.code === 'refused' ? '' : 'Choose the file again to try again.'}
        </p>
      )}
      {view.copy.kind === 'done' && isImageFormat(report.format) && <VerificationView report={report} originalUrl={view.originalUrl} copy={view.copy.result} onDownload={actions.download} />}

      <div class="reset-row">
        <button type="button" class="button" onClick={actions.reset}>
          Clear and start over
        </button>
        <p class="fine-print">Clearing stops any work, releases the file and the copy from memory, and revokes the preview links.</p>
      </div>
    </>
  );
}

function PdfPreviewBox({ state, onShow, busy }: { state: PdfPreview; onShow: () => void; busy: boolean }) {
  return (
    <section class="pdf-preview" aria-labelledby="pdfp-h">
      <h2 id="pdfp-h" class="section-title">
        Page 1 preview
      </h2>
      {state.state === 'ready' ? (
        <figure>
          <img src={state.url} alt="Page 1 of the document, drawn as a plain picture" decoding="async" />
          <figcaption class="fine-print">A plain picture of page 1. Scripts, links, forms and annotations are not run or drawn. Fonts that are not embedded in the file may look different.</figcaption>
        </figure>
      ) : (
        <>
          <p>The preview is drawn inside a separate worker and shown as an image. Scripts, actions and forms in the document are not run.</p>
          {state.state === 'error' && <p class="fine-print">The preview could not be drawn: {state.message}</p>}
          <button type="button" class="button" onClick={onShow} disabled={busy}>
            {state.state === 'loading' ? 'Drawing…' : 'Show page 1 as a picture'}
          </button>
        </>
      )}
    </section>
  );
}
