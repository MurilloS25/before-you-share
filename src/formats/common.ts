import { LIMITS } from '../core/limits';
import type { CoverageItem, Dimensions, Finding } from '../core/types';

/** What a format analyser returns before the worker adds fingerprint and timing. */
export interface FormatAnalysis {
  findings: Finding[];
  coverage: CoverageItem[];
  dimensions: Dimensions | null;
  orientation: number | null;
  structurallyUnsound: boolean;
  copyRefusal: string | null;
}

/** Reason an image of this declared size cannot be decoded, previewed, compared or copied; else null. */
export function imageSizeRefusal(d: Dimensions | null): string | null {
  if (!d) return null;
  if (d.width > LIMITS.maxDecodeEdge || d.height > LIMITS.maxDecodeEdge || d.width * d.height > LIMITS.maxDecodePixels) {
    return 'The declared image size is larger than this tool will decode, so a copy could not be visually checked.';
  }
  return null;
}
