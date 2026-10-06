import { concat } from '../core/bytes';
import { RefusedError } from '../core/errors';
import type { ManifestEntry, MutationManifest } from '../core/types';
import { POLICY } from './policy';
import { analyseJpeg, classifySegment, scanJpeg } from '../formats/jpeg';

const KIND_LABEL: Record<string, string> = {
  exif: 'EXIF segment',
  xmp: 'XMP segment',
  'xmp-extension': 'Extended XMP segment',
  photoshop: 'Photoshop / IPTC segment',
  comment: 'Comment segment',
  jfxx: 'JFXX thumbnail segment',
  mpf: 'Multi-picture (MPF) segment',
  'app-other': 'Application segment',
  jfif: 'JFIF header',
  icc: 'ICC colour profile',
  adobe: 'Adobe colour marker',
};

/** APP1 Exif segment containing only the Orientation tag (big-endian TIFF). */
export function orientationOnlyExifSegment(orientation: number): Uint8Array {
  const payload = Uint8Array.of(
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // TIFF header, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation & 0xff, 0x00, 0x00, // Orientation SHORT
    0x00, 0x00, 0x00, 0x00, // no next IFD
  );
  const len = payload.length + 2;
  return concat([Uint8Array.of(0xff, 0xe1, (len >> 8) & 0xff, len & 0xff), payload]);
}

/** Bytes of embedded thumbnail pixels in a JFIF APP0 segment (0 when none or the segment is too short). */
export function jfifThumbnailBytes(bytes: Uint8Array, seg: { payloadOffset: number; payloadLength: number }): number {
  if (seg.payloadLength < 14) return 0;
  const tx = bytes[seg.payloadOffset + 12]!;
  const ty = bytes[seg.payloadOffset + 13]!;
  return tx * ty > 0 ? Math.max(0, seg.payloadLength - 14) : 0;
}

export interface JpegTransform {
  output: Uint8Array;
  manifest: MutationManifest;
}

export function sanitiseJpeg(bytes: Uint8Array, groups: string[]): JpegTransform {
  const analysis = analyseJpeg(bytes);
  if (analysis.copyRefusal) throw new RefusedError(analysis.copyRefusal);
  const scan = scanJpeg(bytes);
  const selected = new Set(groups);
  const entries: ManifestEntry[] = [];
  const parts: Uint8Array[] = [];
  let cursor = 0;
  let orientationInserted = false;
  const keepOrientation = analysis.orientation !== null && analysis.orientation !== 1;

  const cut = (start: number, end: number, what: string, group: string): void => {
    if (start > cursor) parts.push(bytes.subarray(cursor, start));
    cursor = end;
    entries.push({ action: 'removed', what, group, offset: start, bytes: end - start });
  };

  for (const seg of scan.segments) {
    const cls = classifySegment(bytes, seg);
    const label = KIND_LABEL[cls.kind] ?? 'Segment';
    if (cls.group && !cls.alwaysKeep && selected.has(cls.group)) {
      if (cls.kind === 'exif' && keepOrientation && !orientationInserted) {
        // Replace the first EXIF segment with an orientation-only one; later EXIF segments are removed.
        const replacement = orientationOnlyExifSegment(analysis.orientation!);
        if (seg.offset > cursor) parts.push(bytes.subarray(cursor, seg.offset));
        parts.push(replacement);
        cursor = seg.offset + seg.length;
        orientationInserted = true;
        entries.push({
          action: 'rewritten',
          what: 'EXIF segment replaced by one that holds only the orientation value',
          group: cls.group,
          offset: seg.offset,
          bytes: replacement.length,
          note: `Original segment: ${seg.length} bytes.`,
        });
        continue;
      }
      cut(seg.offset, seg.offset + seg.length, label, cls.group);
    } else if (cls.kind === 'jfif' && selected.has('other-segments') && jfifThumbnailBytes(bytes, seg) > 0) {
      // Keep the header (version and density) but drop the embedded thumbnail: set its size to 0x0 and cut its pixels.
      const header = Uint8Array.from(bytes.subarray(seg.payloadOffset, seg.payloadOffset + 14));
      header[12] = 0;
      header[13] = 0;
      const len = header.length + 2;
      const replacement = concat([Uint8Array.of(0xff, 0xe0, (len >> 8) & 0xff, len & 0xff), header]);
      if (seg.offset > cursor) parts.push(bytes.subarray(cursor, seg.offset));
      parts.push(replacement);
      cursor = seg.offset + seg.length;
      entries.push({
        action: 'rewritten',
        what: 'JFIF header rewritten without its embedded thumbnail',
        group: 'other-segments',
        offset: seg.offset,
        bytes: replacement.length,
        note: `Original segment: ${seg.length} bytes.`,
      });
    } else if (cls.kind === 'icc' || cls.kind === 'adobe' || cls.kind === 'jfif') {
      entries.push({ action: 'preserved', what: label, offset: seg.offset, bytes: seg.length, note: 'Kept because it affects how the picture is displayed.' });
    } else if (cls.group && !cls.alwaysKeep) {
      entries.push({ action: 'preserved', what: label, group: cls.group, offset: seg.offset, bytes: seg.length, note: 'Not selected for removal.' });
    }
  }
  if (scan.trailingStart !== null && scan.trailingStart < bytes.length) {
    const mpfKept = !selected.has('other-segments') && scan.segments.some((s) => classifySegment(bytes, s).kind === 'mpf');
    if (selected.has('trailer') && mpfKept) {
      entries.push({
        action: 'preserved',
        what: 'Multi-picture (MPF) index segment',
        group: 'other-segments',
        offset: null,
        bytes: 0,
        note: 'Kept, but the images it points to after the end-of-image marker were removed, so its index now points at missing data. Select "Other application segments" too to remove it.',
      });
    }
    if (selected.has('trailer')) {
      cut(scan.trailingStart, bytes.length, 'Data after the end-of-image marker', 'trailer');
    } else {
      entries.push({ action: 'preserved', what: 'Data after the end-of-image marker', group: 'trailer', offset: scan.trailingStart, bytes: bytes.length - scan.trailingStart, note: 'Not selected for removal.' });
    }
  }
  parts.push(bytes.subarray(cursor));
  const output = concat(parts);
  const manifest: MutationManifest = {
    schema: 1,
    format: 'jpeg',
    selectedGroups: [...selected].sort(),
    entries,
    inputBytes: bytes.length,
    outputBytes: output.length,
    preservedPolicy: [...POLICY.jpeg.preserved],
    mayChange: [...POLICY.jpeg.mayChange],
  };
  return { output, manifest };
}
