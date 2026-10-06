import { buildFingerprint, detectFormat, DOCX_MIME, SNIFF_BYTES, type Detection } from './detect';
import { FindingSink } from './findings';
import { LIMITS, type FormatId } from './limits';
import { RefusedError } from './errors';
import type { AnalysisReport, DocxSummary, Fingerprint, PdfSummary } from './types';
import type { FormatAnalysis } from '../formats/common';
import { analyseJpeg } from '../formats/jpeg';
import { analysePng } from '../formats/png';

export interface FileMeta {
  /** Held in memory only, displayed as text, never logged or stored. */
  name: string;
  type: string;
}

export type AnalysisOutcome =
  | { supported: true; report: AnalysisReport }
  | { supported: false; fingerprint: Fingerprint; detection: Detection };

export async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const digest = await subtle.digest('SHA-256', bytes as BufferSource);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export function sizeLimitFor(format: FormatId): number {
  return LIMITS.maxFileBytes[format];
}

export async function analyseBytes(bytes: Uint8Array, meta: FileMeta, now: () => number = () => performance.now()): Promise<AnalysisOutcome> {
  const started = now();
  let detection = detectFormat(bytes.subarray(0, SNIFF_BYTES));
  // A ZIP is a DOCX only if its directory has the Word package parts. Anything else stays "unsupported".
  let docxDir: import('../formats/zip').ZipDirectory | null = null;
  if (!detection.format && detection.mime === 'application/zip' && bytes.length <= LIMITS.maxFileBytes.docx) {
    const [zip, docx] = await Promise.all([import('../formats/zip'), import('../formats/docx')]);
    const dir = zip.readZipDirectory(bytes);
    if (docx.looksLikeDocx(dir)) {
      docxDir = dir;
      detection = { format: 'docx', mime: DOCX_MIME, label: 'Word document (DOCX)', recognisedUnsupported: false };
    }
  }
  const sha = await sha256Hex(bytes);
  const fingerprint = buildFingerprint(bytes.length, meta.name, meta.type, detection, sha);
  const format = detection.format;
  if (!format) return { supported: false, fingerprint, detection };
  if (bytes.length > sizeLimitFor(format)) {
    throw new RefusedError(`This ${detection.label.toLowerCase()} is larger than the ${Math.round(sizeLimitFor(format) / 1048576)} MiB this tool will read.`);
  }

  let analysis: FormatAnalysis;
  let pdf: PdfSummary | undefined;
  let docxSummary: DocxSummary | undefined;
  if (format === 'jpeg') analysis = analyseJpeg(bytes);
  else if (format === 'png') analysis = await analysePng(bytes);
  else if (format === 'docx') {
    const mod = await import('../formats/docx');
    const res = await mod.analyseDocx(bytes, docxDir ?? undefined);
    analysis = res;
    docxSummary = res.docx;
  } else {
    // PDF tooling is only loaded when a PDF is actually inspected.
    const mod = await import('../formats/pdf');
    const res = await mod.analysePdf(bytes);
    analysis = res;
    pdf = res.pdf;
  }

  const mismatch = new FindingSink();
  if (fingerprint.extensionCheck === 'mismatch' || fingerprint.declaredTypeCheck === 'mismatch') {
    const parts: string[] = [];
    if (fingerprint.extensionCheck === 'mismatch') parts.push(`the file name ends in “.${fingerprint.extension}”`);
    if (fingerprint.declaredTypeCheck === 'mismatch') parts.push(`the browser reported the type “${fingerprint.declaredType || 'unknown'}”`);
    mismatch.add('file.type-mismatch', {
      value: `${parts.join(' and ')}, but the content is ${detection.label}`,
      source: 'File name and declared type compared with file content',
      status: 'verified',
      confidence: 'high',
      group: null,
      transformation: 'unsupported',
    });
  }

  const report: AnalysisReport = {
    schema: 1,
    format,
    fingerprint,
    dimensions: analysis.dimensions,
    findings: [...mismatch.findings, ...analysis.findings],
    coverage: analysis.coverage,
    structurallyUnsound: analysis.structurallyUnsound,
    copyRefusal: format === 'pdf' ? 'Copies are not offered for PDF files. This tool inspects PDFs only.' : analysis.copyRefusal,
    orientation: analysis.orientation,
    elapsedMs: Math.round(now() - started),
  };
  if (pdf) report.pdf = pdf;
  if (docxSummary) report.docx = docxSummary;
  return { supported: true, report };
}
