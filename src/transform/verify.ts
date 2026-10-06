import { analyseBytes, sha256Hex } from '../core/analyze';
import { concat } from '../core/bytes';
import { RefusedError } from '../core/errors';
import type { FormatId } from '../core/limits';
import type { AnalysisReport, Finding, MutationManifest, TransformResult, VerificationCheck, VerificationResult } from '../core/types';
import { classifyChunk, scanPng } from '../formats/png';
import { scanJpeg } from '../formats/jpeg';
import { sanitiseJpeg } from './jpeg';
import { sanitisePng } from './png';

export interface DecodeComparison {
  /** null when not attempted (for example no decoder available or the image is too large). */
  dimensionsEqual: boolean | null;
  pixelsIdentical: boolean | null;
  detail: string;
  /** True when a decoder threw for either file. */
  failed: boolean;
}
export type DecodeCompare = (original: Uint8Array, copy: Uint8Array, format: FormatId, orientation: number | null) => Promise<DecodeComparison>;

const key = (f: Finding): string => `${f.code}|${f.label}|${f.value ?? ''}`;

/** Bytes of everything that is neither metadata nor trailing data, in order. Used to prove picture data is unchanged. */
export function jpegCore(bytes: Uint8Array): Uint8Array {
  const scan = scanJpeg(bytes);
  const parts: Uint8Array[] = [];
  let cursor = 0;
  for (const s of scan.segments) {
    const isMeta = (s.marker >= 0xe0 && s.marker <= 0xef) || s.marker === 0xfe;
    if (isMeta) {
      parts.push(bytes.subarray(cursor, s.offset));
      cursor = s.offset + s.length;
    }
  }
  const end = scan.trailingStart ?? bytes.length;
  parts.push(bytes.subarray(cursor, end));
  return concat(parts);
}

export function pngCore(bytes: Uint8Array): Uint8Array {
  const scan = scanPng(bytes);
  return concat(scan.chunks.filter((c) => classifyChunk(c.type).alwaysKeep).map((c) => bytes.subarray(c.offset, c.offset + c.total)));
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Re-parse the generated copy with the same analysers and compare it with the original.
 * A pass means "these checks found no problem". It never means the copy is clean or safe.
 */
export async function verifyCopy(
  original: Uint8Array,
  originalSha: string | null,
  originalReport: AnalysisReport,
  output: Uint8Array,
  groups: string[],
  decode?: DecodeCompare,
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];
  const format = originalReport.format;
  const outcome = await analyseBytes(output, { name: '', type: '' });
  if (!outcome.supported || outcome.report.format !== format) {
    throw new RefusedError('The generated copy was not recognised as the same format.');
  }
  const copyReport = outcome.report;
  const selected = new Set(groups);

  checks.push({
    id: 'format',
    label: 'The copy is recognised as the same format and is structurally sound',
    status: copyReport.structurallyUnsound ? 'fail' : 'pass',
    detail: copyReport.structurallyUnsound ? 'The copy has structural problems.' : 'Every segment or chunk of the copy was walked again without errors.',
  });

  const origKeys = new Set(originalReport.findings.map(key));
  const copyKeys = new Set(copyReport.findings.map(key));
  const removedFindings = originalReport.findings.filter((f) => f.group && f.transformation === 'removable' && selected.has(f.group));
  const stillThere = removedFindings.filter((f) => copyKeys.has(key(f)));
  const removedGone = removedFindings.filter((f) => !copyKeys.has(key(f)));
  checks.push({
    id: 'selected-removed',
    label: 'Selected fields were no longer detected in the copy',
    status: stillThere.length === 0 ? 'pass' : 'fail',
    detail:
      stillThere.length === 0
        ? `${removedGone.length} finding${removedGone.length === 1 ? '' : 's'} from the original were not detected again. Other hidden information may remain.`
        : `${stillThere.length} selected finding${stillThere.length === 1 ? ' was' : 's were'} detected again.`,
  });

  const newFindings = copyReport.findings.filter((f) => !origKeys.has(key(f)));
  checks.push({
    id: 'nothing-new',
    label: 'The copy contains no findings that were absent from the original',
    status: newFindings.length === 0 ? 'pass' : 'fail',
    detail: newFindings.length === 0 ? 'No new findings appeared.' : `${newFindings.length} new finding${newFindings.length === 1 ? '' : 's'} appeared.`,
  });

  const keptOk = originalReport.findings.filter((f) => f.transformation === 'preserved').every((f) => copyKeys.has(key(f)));
  checks.push({
    id: 'kept-as-planned',
    label: 'Display-related data that should be kept is still present',
    status: keptOk ? 'pass' : 'fail',
    detail: keptOk ? 'Colour profile, orientation and similar items are unchanged.' : 'Something that should have been kept is missing.',
  });

  const coreEqual = format === 'jpeg' ? equal(jpegCore(original), jpegCore(output)) : equal(pngCore(original), pngCore(output));
  checks.push({
    id: 'picture-data',
    label: 'Compressed picture data is byte-identical to the original',
    status: coreEqual ? 'pass' : 'fail',
    detail: coreEqual ? 'Image data and structural headers were copied without change, so the picture was not re-encoded.' : 'The picture data differs from the original.',
  });

  const dimsEqual =
    originalReport.dimensions !== null &&
    copyReport.dimensions !== null &&
    originalReport.dimensions.width === copyReport.dimensions.width &&
    originalReport.dimensions.height === copyReport.dimensions.height;
  checks.push({
    id: 'dimensions',
    label: 'Image dimensions are unchanged',
    status: dimsEqual ? 'pass' : 'fail',
    detail: dimsEqual ? `${copyReport.dimensions!.width} × ${copyReport.dimensions!.height} pixels in both files.` : 'The dimensions differ.',
  });

  const orientationEqual = originalReport.orientation === copyReport.orientation || (originalReport.orientation === 1 && copyReport.orientation === null);
  checks.push({
    id: 'orientation',
    label: 'Orientation is unchanged',
    status: orientationEqual ? 'pass' : 'fail',
    detail: orientationEqual ? 'The orientation value is the same as in the original.' : 'The orientation value differs.',
  });

  const afterSha = await sha256Hex(original);
  checks.push({
    id: 'original-untouched',
    label: 'The original bytes in memory were not modified',
    status: originalSha === null || afterSha === null ? 'skipped' : originalSha === afterSha ? 'pass' : 'fail',
    detail: originalSha === null ? 'Hashing is unavailable in this browser context.' : originalSha === afterSha ? 'The original was only read. Your file on disk is never written to.' : 'The in-memory original changed.',
  });

  let pixelsIdentical: boolean | null = null;
  let decodeDims: boolean | null = null;
  if (decode) {
    const d = await decode(original, output, format, originalReport.orientation);
    pixelsIdentical = d.pixelsIdentical;
    decodeDims = d.dimensionsEqual;
    checks.push({
      id: 'decode',
      label: 'Both files decode in this browser and look identical pixel for pixel',
      status: d.failed ? 'fail' : d.pixelsIdentical === true && d.dimensionsEqual !== false ? 'pass' : d.pixelsIdentical === false || d.dimensionsEqual === false ? 'fail' : 'skipped',
      detail: d.detail,
    });
  } else {
    checks.push({ id: 'decode', label: 'Both files decode in this browser and look identical pixel for pixel', status: 'skipped', detail: 'No browser decoder is available in this context.' });
  }

  return {
    checks,
    allPassed: checks.every((c) => c.status !== 'fail'),
    removedFindings: removedGone,
    remainingFindings: copyReport.findings.filter((f) => origKeys.has(key(f))),
    newFindings,
    copyReport,
    dimensionsEqual: decodeDims ?? dimsEqual,
    pixelsIdentical,
  };
}

/** Build the copy, then verify it. The input buffer is never written to. */
export async function createCopy(
  original: Uint8Array,
  report: AnalysisReport,
  groups: string[],
  decode?: DecodeCompare,
): Promise<TransformResult> {
  if (report.format === 'pdf') throw new RefusedError('Copies are not offered for PDF files.');
  if (report.copyRefusal) throw new RefusedError(report.copyRefusal);
  if (groups.length === 0) throw new RefusedError('Choose at least one item to remove.');
  const before = await sha256Hex(original);
  let result: { output: Uint8Array; manifest: MutationManifest };
  if (report.format === 'jpeg') result = sanitiseJpeg(original, groups);
  else result = await sanitisePng(original, groups);
  const verification = await verifyCopy(original, before, report, result.output, groups, decode);
  return { output: result.output, manifest: result.manifest, verification };
}
