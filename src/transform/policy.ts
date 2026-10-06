import type { AnalysisReport, Finding } from '../core/types';

/** Plain-language statements about what a copy keeps and may change. Shown before the copy is made and recorded in the manifest. */
export const POLICY = {
  jpeg: {
    preserved: [
      'The compressed picture data and all structural segments (quantisation tables, Huffman tables, frame and scan headers) are copied byte for byte.',
      'JFIF headers, ICC colour profiles and Adobe colour markers are kept because removing them can change how the picture looks.',
      'Anything not selected for removal is kept, including structures this tool cannot decode.',
    ],
    mayChange: [
      'The file size and byte layout change.',
      'Programs that rely on the removed data (for example photo libraries sorting by date or place) will no longer find it.',
      'The picture is not re-encoded, so quality and colours are not recompressed. This is checked, not assumed.',
    ],
  },
  png: {
    preserved: [
      'Image data (IDAT), the header, palette and transparency chunks are copied byte for byte.',
      'Colour and display chunks (iCCP, sRGB, gAMA, cHRM, cICP, pHYs, bKGD, sBIT and animation chunks) are kept because removing them can change how the picture looks.',
      'Anything not selected for removal is kept, including chunks this tool cannot decode.',
    ],
    mayChange: [
      'The file size and byte layout change.',
      'Programs that rely on the removed data (for example software that reads creation time) will no longer find it.',
      'The picture is not re-encoded. This is checked, not assumed.',
    ],
  },
} as const;

/** Findings that will still be present in a copy made with `groups`. Structural facts about the image itself are excluded. */
export function remainingAfter(report: AnalysisReport, groups: string[]): Finding[] {
  const selected = new Set(groups);
  return report.findings.filter((f) => !(f.group && f.transformation === 'removable' && selected.has(f.group)) && f.category !== 'structural');
}

export function removedBy(report: AnalysisReport, groups: string[]): Finding[] {
  const selected = new Set(groups);
  return report.findings.filter((f) => f.group && f.transformation === 'removable' && selected.has(f.group));
}
