import type { FormatId } from './limits';
import type { StructuredError } from './errors';

export type EvidenceStatus = 'verified' | 'inferred' | 'suspicious' | 'unsupported' | 'unavailable';
export type Confidence = 'high' | 'medium' | 'low';

export type Category =
  | 'identity'
  | 'location'
  | 'time'
  | 'device-software'
  | 'embedded-content'
  | 'document-properties'
  | 'active-features'
  | 'structural'
  | 'unsupported';

/** Presentation order of categories, calm and non-ranked by alarm. */
export const CATEGORY_ORDER: Category[] = [
  'location',
  'identity',
  'time',
  'device-software',
  'document-properties',
  'embedded-content',
  'active-features',
  'structural',
  'unsupported',
];

export type EvidenceLocation =
  | { kind: 'bytes'; offset: number; length: number }
  | { kind: 'structure'; path: string }
  | { kind: 'none' };

/**
 * - removable: the experimental copy can remove it (`group` names the removal option)
 * - preserved: the copy deliberately keeps it (it affects how the file displays or cannot be judged)
 * - unsupported: no transformation exists for this format or structure
 */
export type TransformationSupport = 'removable' | 'preserved' | 'unsupported';

export interface Finding {
  /** Stable within one analysis: `<code>#<n>`. */
  id: string;
  /** Catalogue code, e.g. `exif.gps-position`. Stable across releases. */
  code: string;
  category: Category;
  label: string;
  /** Normalised value as plain text. Null when the finding is about a structure, not a value. */
  value: string | null;
  /** Where the value was read from, e.g. `EXIF GPS IFD, tags 0x0001-0x0004`. */
  source: string;
  location: EvidenceLocation;
  status: EvidenceStatus;
  confidence: Confidence;
  privacyExplanation: string;
  removable: boolean;
  /** Removal option that controls this finding in the experimental copy. */
  group?: string;
  transformation: TransformationSupport;
  limitations: string[];
}

export type CoverageState = 'inspected' | 'partial' | 'not-inspected';

export interface CoverageItem {
  area: string;
  state: CoverageState;
  note: string;
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface Fingerprint {
  size: number;
  declaredType: string;
  detectedType: string;
  detectedFormat: FormatId | null;
  extension: string;
  /** 'match' | 'mismatch' | 'unknown'. Informational: neither extension nor MIME is trusted. */
  extensionCheck: 'match' | 'mismatch' | 'unknown';
  declaredTypeCheck: 'match' | 'mismatch' | 'unknown';
  /** Lower-case hex SHA-256 of the bytes, or null when unavailable. Identifies bytes; says nothing about safety. */
  sha256: string | null;
}

export interface AnalysisReport {
  schema: 1;
  format: FormatId;
  fingerprint: Fingerprint;
  dimensions: Dimensions | null;
  findings: Finding[];
  coverage: CoverageItem[];
  /** True when a structural problem makes a transformation unsafe (reason in `refusal`). */
  structurallyUnsound: boolean;
  /** Plain-language reason a copy cannot be offered, or null when supported. */
  copyRefusal: string | null;
  /** Orientation tag value 1-8 when present (JPEG). */
  orientation: number | null;
  /** Elapsed milliseconds in the worker. Never contains file data. */
  elapsedMs: number;
  /** PDF only: facts from the reviewed library. */
  pdf?: PdfSummary;
}

export interface PdfSummary {
  version: string | null;
  pageCount: number | null;
  pagesInspected: number;
  encrypted: boolean;
  incrementalUpdates: number | null;
  libraryUsed: boolean;
}

export interface RemovalGroup {
  id: string;
  label: string;
  description: string;
  defaultOn: boolean;
  /** Findings in the analysed file that belong to this group. */
  findingCount: number;
}

export interface ManifestEntry {
  action: 'removed' | 'rewritten' | 'inserted' | 'preserved';
  what: string;
  group?: string;
  offset: number | null;
  bytes: number;
  note?: string;
}

export interface MutationManifest {
  schema: 1;
  format: FormatId;
  selectedGroups: string[];
  entries: ManifestEntry[];
  inputBytes: number;
  outputBytes: number;
  /** Plain statements of what is deliberately unchanged. */
  preservedPolicy: string[];
  /** Plain statements of what may change. */
  mayChange: string[];
}

export type CheckStatus = 'pass' | 'fail' | 'skipped';
export interface VerificationCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface VerificationResult {
  checks: VerificationCheck[];
  /** True only when no check failed. Passing never means the copy is "clean". */
  allPassed: boolean;
  removedFindings: Finding[];
  remainingFindings: Finding[];
  newFindings: Finding[];
  copyReport: AnalysisReport;
  dimensionsEqual: boolean | null;
  pixelsIdentical: boolean | null;
}

export interface TransformResult {
  /** Bytes of the experimental copy. Never the original buffer. */
  output: Uint8Array;
  manifest: MutationManifest;
  verification: VerificationResult;
}

export type JobResult<T> = { ok: true; value: T } | { ok: false; error: StructuredError };
