/// <reference lib="webworker" />
import { analyseBytes } from '../core/analyze';
import { buildFingerprint, detectFormat, SNIFF_BYTES } from '../core/detect';
import { RefusedError, toStructuredError, ParseLimitError } from '../core/errors';
import { LIMITS } from '../core/limits';
import type { AnalysisReport } from '../core/types';
import { createCopy } from '../transform/verify';
import { removalGroupsFor } from '../transform/groups';
import { compareDecoded } from './decode';
import type { JobStage, ResultPayload, WorkerRequest, WorkerResponse } from './protocol';

/**
 * Analysis worker. It holds the bytes of the current file in memory only, never writes them anywhere,
 * never logs, and never opens a network connection. The page ends a job (and frees all memory) by
 * terminating the worker.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;

interface Session {
  bytes: Uint8Array;
  report: AnalysisReport;
}
let session: Session | null = null;

const send = (m: WorkerResponse, transfer: Transferable[] = []): void => ctx.postMessage(m, transfer);
const progress = (jobId: number, stage: JobStage, fraction: number | null): void => send({ type: 'progress', jobId, stage, fraction });

async function readAll(file: File, jobId: number): Promise<Uint8Array> {
  const size = file.size;
  const out = new Uint8Array(size);
  const reader = file.stream().getReader();
  let offset = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.length > size) {
      await reader.cancel().catch(() => undefined);
      throw new RefusedError('The file changed while it was being read.');
    }
    out.set(value, offset);
    offset += value.length;
    if (offset - lastReport > 1_000_000 || offset === size) {
      lastReport = offset;
      progress(jobId, 'reading', size === 0 ? 1 : offset / size);
    }
  }
  if (offset !== size) throw new RefusedError('The file changed while it was being read.');
  return out;
}

async function analyse(jobId: number, file: File): Promise<ResultPayload> {
  session = null;
  if (file.size === 0) throw new RefusedError('The file is empty.');
  if (file.size > LIMITS.maxAnyFileBytes) throw new RefusedError(`This file is larger than the ${Math.round(LIMITS.maxAnyFileBytes / 1048576)} MiB this tool will read.`);
  progress(jobId, 'reading', 0);
  // Read only the first bytes to identify the format, so oversized or unsupported files are never fully loaded.
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  let detection = detectFormat(head);
  // A ZIP may be a DOCX; it is read (up to the DOCX limit) so its directory can be checked. Any other unknown content is not read.
  const maybeDocx = !detection.format && detection.mime === 'application/zip' && file.size <= LIMITS.maxFileBytes.docx;
  if (!detection.format && detection.mime === 'application/zip' && !maybeDocx) {
    detection = { ...detection, label: `ZIP-based container larger than the ${Math.round(LIMITS.maxFileBytes.docx / 1048576)} MiB this tool examines as a Word document` };
  }
  if (!detection.format && !maybeDocx) {
    return { kind: 'analysis', supported: false, fingerprint: buildFingerprint(file.size, file.name, file.type, detection, null), detection };
  }
  const limit = detection.format ? LIMITS.maxFileBytes[detection.format] : LIMITS.maxFileBytes.docx;
  if (file.size > limit) throw new RefusedError(`This ${detection.label.toLowerCase()} is larger than the ${Math.round(limit / 1048576)} MiB this tool will read for that format.`);
  const bytes = await readAll(file, jobId);
  progress(jobId, 'inspecting', null);
  const outcome = await analyseBytes(bytes, { name: file.name, type: file.type });
  if (!outcome.supported) return { kind: 'analysis', supported: false, fingerprint: outcome.fingerprint, detection: outcome.detection };
  session = { bytes, report: outcome.report };
  return { kind: 'analysis', supported: true, report: outcome.report };
}

async function transform(jobId: number, groups: string[]): Promise<{ payload: ResultPayload; transfer: Transferable[] }> {
  if (!session) throw new RefusedError('There is no open file. Choose the file again.');
  const { bytes, report } = session;
  const allowed = new Set(removalGroupsFor(report).map((g) => g.id));
  if (groups.some((g) => !allowed.has(g))) throw new RefusedError('One of the selected options does not apply to this file.');
  progress(jobId, 'building-copy', null);
  const result = await createCopy(bytes, report, groups, async (a, b, f) => {
    progress(jobId, 'verifying', null);
    return compareDecoded(a, b, f, report.dimensions);
  });
  const buffer = result.output.buffer.slice(result.output.byteOffset, result.output.byteOffset + result.output.byteLength) as ArrayBuffer;
  return { payload: { kind: 'transform', output: buffer, manifest: result.manifest, verification: result.verification }, transfer: [buffer] };
}

async function previewPdf(jobId: number): Promise<{ payload: ResultPayload; transfer: Transferable[] }> {
  if (!session || session.report.format !== 'pdf') throw new RefusedError('There is no open PDF.');
  if (session.report.pdf?.encrypted) throw new RefusedError('Encrypted PDFs are not previewed.');
  progress(jobId, 'rendering', null);
  const { renderPdfFirstPage } = await import('./pdfPreview');
  const res = await renderPdfFirstPage(session.bytes);
  return { payload: res, transfer: [res.png] };
}

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  const run = async (): Promise<void> => {
    try {
      if (req.type === 'analyse') {
        send({ type: 'result', jobId: req.jobId, payload: await analyse(req.jobId, req.file) });
      } else if (req.type === 'transform') {
        const r = await transform(req.jobId, req.groups);
        send({ type: 'result', jobId: req.jobId, payload: r.payload }, r.transfer);
      } else if (req.type === 'preview-pdf') {
        const r = await previewPdf(req.jobId);
        send({ type: 'result', jobId: req.jobId, payload: r.payload }, r.transfer);
      }
    } catch (e) {
      const err = toStructuredError(e);
      // Messages from our own typed errors are safe; anything else is replaced by a generic message.
      if (e instanceof RefusedError || e instanceof ParseLimitError) err.message = e.message;
      send({ type: 'error', jobId: req.jobId, error: err });
    }
  };
  void run();
};

send({ type: 'ready' });
