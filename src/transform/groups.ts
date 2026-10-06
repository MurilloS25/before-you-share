import type { FormatId } from '../core/limits';
import type { AnalysisReport, RemovalGroup } from '../core/types';

interface GroupDef {
  id: string;
  label: string;
  description: string;
  defaultOn: boolean;
}

/**
 * Removal options per format. Metadata options are on by default; structures this tool cannot
 * judge (unknown segments, trailing bytes, unknown chunks) are found and reported but kept unless
 * the person chooses to remove them.
 */
const DEFS: Record<'jpeg' | 'png', GroupDef[]> = {
  jpeg: [
    { id: 'exif', label: 'EXIF data', description: 'Camera and device details, dates, GPS position, descriptions, owner and serial numbers, and the embedded thumbnail. The orientation value is kept so the picture is not turned sideways.', defaultOn: true },
    { id: 'xmp', label: 'XMP data', description: 'The XMP text packet and any extended XMP segments: authors, tools, edit history, identifiers.', defaultOn: true },
    { id: 'iptc', label: 'Photoshop and IPTC data', description: 'Captions, credits, keywords, places and embedded Photoshop thumbnails.', defaultOn: true },
    { id: 'comments', label: 'Comments', description: 'JPEG comment segments.', defaultOn: true },
    { id: 'other-segments', label: 'Other application segments', description: 'Segments this tool does not decode, including multi-picture (MPF) data and JFXX thumbnails. Not removed unless selected.', defaultOn: false },
    { id: 'trailer', label: 'Data after the end of the image', description: 'Bytes after the end-of-image marker. This can include extra images or video. Not removed unless selected.', defaultOn: false },
  ],
  png: [
    { id: 'png-text', label: 'Text entries and XMP', description: 'tEXt, zTXt and iTXt chunks, including XMP: authors, software, comments, descriptions.', defaultOn: true },
    { id: 'png-exif', label: 'EXIF chunk', description: 'The eXIf chunk: camera details, dates and GPS position. An orientation value is kept if present.', defaultOn: true },
    { id: 'png-time', label: 'Modification time', description: 'The tIME chunk.', defaultOn: true },
    { id: 'png-unknown', label: 'Unrecognised ancillary chunks', description: 'Optional chunks this tool does not decode. Not removed unless selected.', defaultOn: false },
    { id: 'trailer', label: 'Data after IEND', description: 'Bytes after the end of the PNG. Not removed unless selected.', defaultOn: false },
  ],
};

export function removalGroupsFor(report: AnalysisReport): RemovalGroup[] {
  if (report.format === 'pdf' || report.format === 'docx' || report.copyRefusal) return [];
  const defs = DEFS[report.format];
  return defs
    .map((d) => ({ ...d, findingCount: report.findings.filter((f) => f.group === d.id).length }))
    .filter((g) => g.findingCount > 0);
}

export function groupIdsFor(format: FormatId): string[] {
  return format === 'pdf' || format === 'docx' ? [] : DEFS[format].map((d) => d.id);
}
