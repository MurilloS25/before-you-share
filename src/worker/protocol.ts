import type { StructuredError } from '../core/errors';
import type { AnalysisReport, Fingerprint, MutationManifest, VerificationResult } from '../core/types';
import type { Detection } from '../core/detect';

/** Messages from the page to the analysis worker. */
export type WorkerRequest =
  | { type: 'analyse'; jobId: number; file: File }
  | { type: 'transform'; jobId: number; groups: string[] }
  | { type: 'preview-pdf'; jobId: number };

export type JobStage = 'reading' | 'inspecting' | 'building-copy' | 'verifying' | 'rendering';

export interface AnalyseResult {
  kind: 'analysis';
  supported: true;
  report: AnalysisReport;
}
export interface UnsupportedResult {
  kind: 'analysis';
  supported: false;
  fingerprint: Fingerprint;
  detection: Detection;
}
export interface TransformResultMessage {
  kind: 'transform';
  /** Transferred, not copied. */
  output: ArrayBuffer;
  manifest: MutationManifest;
  verification: VerificationResult;
}
export interface PdfPreviewResult {
  kind: 'pdf-preview';
  /** PNG bytes of page 1 rendered to an inert bitmap. */
  png: ArrayBuffer;
  width: number;
  height: number;
}
export type ResultPayload = AnalyseResult | UnsupportedResult | TransformResultMessage | PdfPreviewResult;

/** Messages from the worker to the page. */
export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'progress'; jobId: number; stage: JobStage; fraction: number | null }
  | { type: 'result'; jobId: number; payload: ResultPayload }
  | { type: 'error'; jobId: number; error: StructuredError };
