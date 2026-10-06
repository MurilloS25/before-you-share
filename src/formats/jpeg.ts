import { Reader, concat, latin1, utf8 } from '../core/bytes';
import { LIMITS } from '../core/limits';
import { FindingSink } from '../core/findings';
import type { CoverageItem, Dimensions, Finding } from '../core/types';
import { parseExif } from './exif';
import { analyseXmp } from './xmp';
import { parseIccHeader } from './icc';
import { parsePhotoshopBlock } from './iptc';
import type { FormatAnalysis } from './common';
import { imageSizeRefusal } from './common';

export interface JpegSegment {
  marker: number;
  /** Offset of the 0xFF marker byte. */
  offset: number;
  /** Total bytes including marker and length field. */
  length: number;
  payloadOffset: number;
  payloadLength: number;
  afterSos: boolean;
}

export interface JpegScan {
  segments: JpegSegment[];
  /** Offset of the EOI marker or null if not found. */
  eoiOffset: number | null;
  /** Offset of the first byte after EOI, if EOI was found. */
  trailingStart: number | null;
  truncated: boolean;
  invalid: string | null;
  limitHit: boolean;
  sofCount: number;
  sosCount: number;
  dimensions: Dimensions | null;
  dnlHeight: boolean;
  precision: number | null;
  components: number | null;
  progressive: boolean;
}

const isSof = (m: number): boolean => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/** Walk the JPEG marker structure without decoding image data. All reads are bounds-checked. */
export function scanJpeg(bytes: Uint8Array): JpegScan {
  const n = bytes.length;
  const scan: JpegScan = {
    segments: [],
    eoiOffset: null,
    trailingStart: null,
    truncated: false,
    invalid: null,
    limitHit: false,
    sofCount: 0,
    sosCount: 0,
    dimensions: null,
    dnlHeight: false,
    precision: null,
    components: null,
    progressive: false,
  };
  if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    scan.invalid = 'Missing start-of-image marker.';
    return scan;
  }
  const r = new Reader(bytes);
  let pos = 2;
  let inScan = false;
  while (pos < n) {
    if (inScan) {
      pos = bytes.indexOf(0xff, pos);
      if (pos === -1) {
        scan.truncated = true;
        return scan;
      }
    }
    if (bytes[pos] !== 0xff) {
      scan.invalid = 'Expected a marker where none was found.';
      return scan;
    }
    // Skip fill bytes (0xFF 0xFF ...).
    while (pos + 1 < n && bytes[pos + 1] === 0xff) pos++;
    if (pos + 1 >= n) {
      scan.truncated = true;
      return scan;
    }
    const m = bytes[pos + 1]!;
    if (m === 0x00) {
      if (inScan) {
        pos += 2;
        continue;
      }
      scan.invalid = 'Stuffed byte outside image data.';
      return scan;
    }
    if (m >= 0xd0 && m <= 0xd7) {
      if (inScan) {
        pos += 2;
        continue;
      }
      scan.invalid = 'Restart marker outside image data.';
      return scan;
    }
    inScan = false;
    if (m === 0xd9) {
      scan.eoiOffset = pos;
      scan.trailingStart = pos + 2;
      return scan;
    }
    if (m === 0x01) {
      pos += 2;
      continue;
    }
    if (m === 0xd8) {
      scan.invalid = 'A second start-of-image marker appears in the main structure.';
      return scan;
    }
    if (pos + 4 > n) {
      scan.truncated = true;
      return scan;
    }
    const len = r.u16(pos + 2);
    if (len < 2) {
      scan.invalid = 'A segment declares a length smaller than its own length field.';
      return scan;
    }
    if (pos + 2 + len > n) {
      scan.truncated = true;
      return scan;
    }
    if (scan.segments.length >= LIMITS.maxJpegSegments) {
      scan.limitHit = true;
      return scan;
    }
    const seg: JpegSegment = {
      marker: m,
      offset: pos,
      length: 2 + len,
      payloadOffset: pos + 4,
      payloadLength: len - 2,
      afterSos: scan.sosCount > 0,
    };
    scan.segments.push(seg);
    if (isSof(m)) {
      scan.sofCount++;
      if (scan.sofCount === 1 && seg.payloadLength >= 6) {
        scan.precision = r.u8(seg.payloadOffset);
        const h = r.u16(seg.payloadOffset + 1);
        const w = r.u16(seg.payloadOffset + 3);
        scan.components = r.u8(seg.payloadOffset + 5);
        scan.progressive = m === 0xc2 || m === 0xc6 || m === 0xca || m === 0xce;
        if (h === 0) scan.dnlHeight = true;
        if (w > 0 && h > 0) scan.dimensions = { width: w, height: h };
      }
    }
    if (m === 0xda) {
      scan.sosCount++;
      inScan = true;
    }
    pos += 2 + len;
  }
  scan.truncated = true;
  return scan;
}

export type SegmentKind =
  | 'jfif'
  | 'jfxx'
  | 'exif'
  | 'xmp'
  | 'xmp-extension'
  | 'icc'
  | 'mpf'
  | 'photoshop'
  | 'adobe'
  | 'app-other'
  | 'comment'
  | 'structure';

export interface SegmentClass {
  kind: SegmentKind;
  /** Removal option that governs the segment, if any. */
  group: string | null;
  /** True when the sanitiser keeps this segment even if its group is selected. */
  alwaysKeep: boolean;
}

const XMP_ID = 'http://ns.adobe.com/xap/1.0/\u0000';
const XMP_EXT_ID = 'http://ns.adobe.com/xmp/extension/\u0000';

/**
 * Single source of truth for what each segment is and which removal option governs it.
 * The analyser and the transformer both use it so that policy and report cannot disagree.
 */
export function classifySegment(bytes: Uint8Array, seg: JpegSegment): SegmentClass {
  const r = new Reader(bytes);
  const m = seg.marker;
  const p = seg.payloadOffset;
  const has = (text: string): boolean => r.startsWithAscii(p, text) && seg.payloadLength >= text.length;
  if (m === 0xfe) return { kind: 'comment', group: 'comments', alwaysKeep: false };
  if (m === 0xe0) {
    if (has('JFIF\u0000')) return { kind: 'jfif', group: null, alwaysKeep: true };
    if (has('JFXX\u0000')) return { kind: 'jfxx', group: 'other-segments', alwaysKeep: false };
    return { kind: 'app-other', group: 'other-segments', alwaysKeep: false };
  }
  if (m === 0xe1) {
    if (has('Exif\u0000\u0000')) return { kind: 'exif', group: 'exif', alwaysKeep: false };
    if (has(XMP_ID)) return { kind: 'xmp', group: 'xmp', alwaysKeep: false };
    if (has(XMP_EXT_ID)) return { kind: 'xmp-extension', group: 'xmp', alwaysKeep: false };
    return { kind: 'app-other', group: 'other-segments', alwaysKeep: false };
  }
  if (m === 0xe2) {
    if (has('ICC_PROFILE\u0000')) return { kind: 'icc', group: null, alwaysKeep: true };
    if (has('MPF\u0000')) return { kind: 'mpf', group: 'other-segments', alwaysKeep: false };
    return { kind: 'app-other', group: 'other-segments', alwaysKeep: false };
  }
  if (m === 0xed) {
    if (has('Photoshop 3.0\u0000')) return { kind: 'photoshop', group: 'iptc', alwaysKeep: false };
    return { kind: 'app-other', group: 'other-segments', alwaysKeep: false };
  }
  if (m === 0xee) {
    if (has('Adobe')) return { kind: 'adobe', group: null, alwaysKeep: true };
    return { kind: 'app-other', group: 'other-segments', alwaysKeep: false };
  }
  if (m >= 0xe0 && m <= 0xef) return { kind: 'app-other', group: 'other-segments', alwaysKeep: false };
  return { kind: 'structure', group: null, alwaysKeep: true };
}

function appId(bytes: Uint8Array, seg: JpegSegment): string {
  const end = Math.min(seg.payloadLength, 24);
  const raw = bytes.subarray(seg.payloadOffset, seg.payloadOffset + end);
  let s = '';
  for (const b of raw) {
    if (b === 0) break;
    s += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '�';
  }
  return s;
}

export function analyseJpeg(bytes: Uint8Array): FormatAnalysis {
  return analyseJpegInto(bytes, new FindingSink());
}

function analyseJpegInto(bytes: Uint8Array, sink: FindingSink): FormatAnalysis {
  const scan = scanJpeg(bytes);
  const r = new Reader(bytes);
  let orientation: number | null = null;
  let exifSeen = 0;
  let xmpSeen = 0;
  let iccParts: Array<{ seq: number; count: number; data: Uint8Array; offset: number }> = [];
  let iccBytes = 0;
  let xmpExtBytes = 0;
  let xmpExtCount = 0;
  let xmpExtOffset = 0;

  for (const seg of scan.segments) {
    const cls = classifySegment(bytes, seg);
    const loc = { kind: 'bytes' as const, offset: seg.offset, length: seg.length };
    const name = `APP${(seg.marker - 0xe0).toString()}`;
    switch (cls.kind) {
      case 'jfif': {
        if (seg.payloadLength >= 14) {
          const p = seg.payloadOffset + 5;
          const units = r.u8(p + 2);
          const xd = r.u16(p + 3);
          const yd = r.u16(p + 5);
          const tx = r.u8(p + 7);
          const ty = r.u8(p + 8);
          const unit = units === 1 ? 'dpi' : units === 2 ? 'dpcm' : '(aspect ratio only)';
          sink.add('jpeg.jfif', {
            value: `version ${r.u8(p)}.${String(r.u8(p + 1)).padStart(2, '0')}, density ${xd}×${yd} ${unit}`,
            source: 'JPEG APP0 (JFIF)',
            location: loc,
          });
          if (tx > 0 && ty > 0) {
            sink.add('jpeg.jfif-thumbnail', {
              value: `${tx}×${ty} pixels`,
              source: 'JPEG APP0 (JFIF) thumbnail fields',
              location: loc,
            });
          }
        }
        break;
      }
      case 'jfxx':
        sink.add('jpeg.jfif-thumbnail', {
          value: `JFXX extension, ${seg.payloadLength} bytes`,
          source: 'JPEG APP0 (JFXX)',
          location: loc,
        });
        break;
      case 'exif': {
        exifSeen++;
        if (exifSeen > 1) {
          sink.add('jpeg.duplicate', {
            value: 'More than one EXIF segment. Only the first was described.',
            source: `JPEG ${name}`,
            location: loc,
            status: 'suspicious',
            group: 'exif',
          });
          break;
        }
        const tiffStart = seg.payloadOffset + 6;
        const tiff = bytes.subarray(tiffStart, seg.payloadOffset + seg.payloadLength);
        const res = parseExif(tiff, tiffStart, sink, 'JPEG APP1 Exif');
        if (res.orientation !== null) orientation = res.orientation;
        break;
      }
      case 'xmp': {
        xmpSeen++;
        const start = seg.payloadOffset + XMP_ID.length;
        const body = bytes.subarray(start, Math.min(seg.payloadOffset + seg.payloadLength, start + LIMITS.maxXmpBytes));
        analyseXmp(body, sink, 'JPEG APP1 XMP', loc);
        if (xmpSeen > 1) {
          sink.add('jpeg.duplicate', {
            value: 'More than one XMP packet.',
            source: `JPEG ${name}`,
            location: loc,
            status: 'suspicious',
            group: 'xmp',
          });
        }
        break;
      }
      case 'xmp-extension':
        xmpExtCount++;
        xmpExtBytes += seg.payloadLength;
        if (xmpExtCount === 1) xmpExtOffset = seg.offset;
        break;
      case 'icc': {
        if (seg.payloadLength >= 14 && iccBytes < LIMITS.maxIccBytes) {
          const data = bytes.subarray(seg.payloadOffset + 14, seg.payloadOffset + seg.payloadLength);
          iccBytes += data.length;
          iccParts.push({ seq: r.u8(seg.payloadOffset + 12), count: r.u8(seg.payloadOffset + 13), data, offset: seg.offset });
        }
        break;
      }
      case 'mpf':
        sink.add('jpeg.mpf', {
          value: `${seg.payloadLength} bytes`,
          source: `JPEG ${name} (MPF)`,
          location: loc,
          status: 'inferred',
          confidence: 'medium',
        });
        break;
      case 'photoshop': {
        const start = seg.payloadOffset + 14;
        const body = bytes.subarray(start, seg.payloadOffset + seg.payloadLength);
        const res = parsePhotoshopBlock(body, start, sink, 'JPEG APP13 Photoshop');
        sink.add('photoshop.block', {
          value: `${res.resources} resource${res.resources === 1 ? '' : 's'}, ${res.iptcDatasets} IPTC dataset${res.iptcDatasets === 1 ? '' : 's'}`,
          source: 'JPEG APP13 (Photoshop 3.0)',
          location: loc,
        });
        break;
      }
      case 'adobe': {
        if (seg.payloadLength >= 12) {
          const t = r.u8(seg.payloadOffset + 11);
          sink.add('jpeg.adobe', {
            value: `colour transform ${t}`,
            source: 'JPEG APP14 (Adobe)',
            location: loc,
          });
        }
        break;
      }
      case 'app-other':
        sink.add('jpeg.app-unknown', {
          value: `${appId(bytes, seg) || 'no identifier'}, ${seg.payloadLength} bytes`,
          source: `JPEG ${name}`,
          location: loc,
          status: 'unsupported',
        });
        break;
      case 'comment':
        sink.add('jpeg.comment', {
          value: utf8(bytes.subarray(seg.payloadOffset, seg.payloadOffset + seg.payloadLength)).replace(/\u0000+$/, ''),
          source: 'JPEG COM segment',
          location: loc,
        });
        break;
      default:
        break;
    }
  }

  if (xmpExtCount > 0) {
    sink.add('xmp.extended', {
      value: `${xmpExtCount} segment${xmpExtCount === 1 ? '' : 's'}, ${xmpExtBytes} bytes`,
      source: 'JPEG APP1 (extended XMP)',
      location: { kind: 'bytes', offset: xmpExtOffset, length: xmpExtBytes },
      status: 'unsupported',
    });
  }

  // ICC: assemble in sequence order when complete, otherwise use the first chunk only.
  if (iccParts.length > 0) {
    iccParts = iccParts.sort((a, b) => a.seq - b.seq);
    const first = iccParts[0]!;
    const complete = iccParts.length === first.count && iccParts.every((p, i) => p.seq === i + 1);
    const profile = complete ? concat(iccParts.map((p) => p.data)) : first.data;
    const icc = parseIccHeader(profile);
    if (icc) {
      sink.add('icc.profile', {
        value: [icc.description, `${icc.colorSpace} ${icc.deviceClass}`, `ICC ${icc.version}`, icc.created ? `profile dated ${icc.created}` : null]
          .filter(Boolean)
          .join(', '),
        source: 'JPEG APP2 (ICC_PROFILE)',
        location: { kind: 'bytes', offset: first.offset, length: iccParts.reduce((a, p) => a + p.data.length, 0) },
        status: complete ? 'verified' : 'inferred',
        confidence: complete ? 'high' : 'medium',
        limitations: complete ? [] : ['The profile is split across segments that could not be reassembled; only the first part was read.'],
      });
    } else {
      sink.add('icc.profile', {
        value: 'A colour profile is present but its header could not be read',
        source: 'JPEG APP2 (ICC_PROFILE)',
        location: { kind: 'bytes', offset: first.offset, length: first.data.length },
        status: 'suspicious',
        confidence: 'medium',
      });
    }
  }

  // Structure
  const trailing = scan.trailingStart !== null ? bytes.length - scan.trailingStart : 0;
  if (scan.trailingStart !== null && trailing > 0) {
    sink.add('jpeg.trailing-data', {
      value: `${trailing} bytes${describeTrailing(bytes, scan.trailingStart)}`,
      source: 'Bytes after the JPEG end-of-image marker',
      location: { kind: 'bytes', offset: scan.trailingStart, length: trailing },
      status: 'suspicious',
    });
  }
  if (scan.truncated) {
    sink.add('jpeg.truncated', { value: null, source: 'JPEG marker walk', status: 'suspicious' });
  }
  if (scan.invalid) {
    sink.add('jpeg.invalid-segment', { value: scan.invalid, source: 'JPEG marker walk', status: 'suspicious' });
  }
  if (scan.limitHit) {
    sink.add('jpeg.limit', {
      value: `More than ${LIMITS.maxJpegSegments} segments`,
      source: 'Safety limit',
      status: 'unsupported',
    });
  }
  if (scan.sofCount > 1) {
    sink.add('jpeg.duplicate', {
      value: `${scan.sofCount} frame headers (SOF) found; only the first was used for dimensions.`,
      source: 'JPEG marker walk',
      status: 'suspicious',
    });
  }

  const dims = scan.dimensions;
  if (dims) {
    sink.add('image.dimensions', {
      value: `${dims.width} × ${dims.height} pixels${scan.progressive ? ', progressive' : ''}${scan.components ? `, ${scan.components} component${scan.components === 1 ? '' : 's'}` : ''}`,
      source: 'JPEG start-of-frame (SOF) segment',
    });
  }
  const refusal = imageSizeRefusal(dims);
  if (refusal) {
    sink.add('image.extreme-dimensions', {
      value: dims ? `${dims.width} × ${dims.height} pixels` : null,
      source: 'JPEG start-of-frame (SOF) segment',
      status: 'suspicious',
    });
  }

  let copyRefusal: string | null = null;
  const unsound =
    scan.truncated || scan.invalid !== null || scan.limitHit || scan.eoiOffset === null || scan.sofCount === 0 || scan.sosCount === 0;
  if (unsound) copyRefusal = 'The JPEG structure is damaged or incomplete, so a copy could not be checked reliably.';
  else if (scan.sofCount > 1) copyRefusal = 'The JPEG has more than one frame header, which this tool does not handle.';
  else if (scan.dnlHeight || !dims) copyRefusal = 'The image height is not stored in the usual place, which this tool does not handle.';
  else if (refusal) copyRefusal = refusal;

  const coverage: CoverageItem[] = [
    { area: 'JPEG structure', state: scan.limitHit || scan.invalid || scan.truncated ? 'partial' : 'inspected', note: 'Marker segments were walked from start to end without decoding image data.' },
    { area: 'EXIF', state: exifSeen > 0 ? 'partial' : 'inspected', note: 'Common fields were decoded. MakerNote and uncommon fields are only counted, and thumbnails were located but not opened.' },
    { area: 'XMP', state: xmpSeen > 0 || xmpExtCount > 0 ? 'partial' : 'inspected', note: 'Well-known properties were extracted from the first XMP packet; extended XMP was not reassembled.' },
    { area: 'IPTC and Photoshop data', state: 'partial', note: 'IPTC text fields and thumbnails were itemised; other Photoshop resources are only counted.' },
    { area: 'Colour profile', state: 'partial', note: 'Only the profile header and description were read.' },
    { area: 'Image content', state: 'not-inspected', note: 'The picture itself (faces, text, places visible in it) is not analysed.' },
    { area: 'Pixel-level hidden data', state: 'not-inspected', note: 'Steganography and data hidden in image data are not examined.' },
  ];
  sink.coverage.push(...coverage);
  return {
    findings: sink.findings as Finding[],
    coverage: sink.coverage,
    dimensions: dims,
    orientation,
    structurallyUnsound: unsound,
    copyRefusal,
  };
}

export function describeTrailing(bytes: Uint8Array, start: number): string {
  if (start + 4 > bytes.length) return '';
  const head = bytes.subarray(start, start + 8);
  if (head[0] === 0xff && head[1] === 0xd8) return ', begins like another JPEG image';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return ', begins like a PNG image';
  if (head[0] === 0x50 && head[1] === 0x4b) return ', begins like a ZIP archive';
  if (latin1(head.subarray(0, 4)) === '%PDF') return ', begins like a PDF document';
  return ', content type not recognised';
}
