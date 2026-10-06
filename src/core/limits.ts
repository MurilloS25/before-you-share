/**
 * Every resource bound used by the app lives here so it can be tested,
 * documented (docs/LIMITS.md) and audited in one place.
 */
export const MiB = 1024 * 1024;

export const LIMITS = {
  /** Maximum bytes accepted per detected format. Larger files are refused before being read. */
  maxFileBytes: { jpeg: 48 * MiB, png: 48 * MiB, pdf: 64 * MiB, docx: 32 * MiB } as const,
  /** Hard ceiling for any file: refused before reading even to detect the format. */
  maxAnyFileBytes: 64 * MiB,
  /** Largest declared pixel count for which the app decodes, previews or compares an image. */
  maxDecodePixels: 36_000_000,
  /** Largest pixel count for which an exact decoded-pixel comparison is attempted. */
  maxComparePixels: 16_000_000,
  /** Largest edge length accepted for decoding. */
  maxDecodeEdge: 16_384,
  maxJpegSegments: 4096,
  maxPngChunks: 20_000,
  maxIfdEntries: 512,
  maxIfds: 12,
  maxTagValueBytes: 1 * MiB,
  /** Characters of any single value shown to the user. */
  maxDisplayChars: 400,
  maxFindings: 600,
  /** Decompressed bytes allowed per compressed chunk and in total per file. */
  maxInflatePerChunk: 256 * 1024,
  maxInflateTotal: 2 * MiB,
  maxIptcDatasets: 256,
  maxXmpBytes: 1 * MiB,
  maxIccBytes: 4 * MiB,
  /** PDF */
  maxPdfPagesInspected: 200,
  /** DOCX (ZIP) */
  maxZipEntries: 2000,
  maxZipPartBytes: 512 * 1024,
  maxZipTotalInflate: 6 * MiB,
  maxZipDeclaredTotal: 512 * MiB,
  maxZipRatio: 1000,
  /** Wall-clock budget for one analysis or transformation job. */
  jobTimeoutMs: 30_000,
} as const;

export type FormatId = 'jpeg' | 'png' | 'pdf' | 'docx';
