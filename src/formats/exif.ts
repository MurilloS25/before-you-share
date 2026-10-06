import { Reader, latin1, utf16le, utf8 } from '../core/bytes';
import { LIMITS } from '../core/limits';
import { ParseLimitError } from '../core/errors';
import type { FindingSink } from '../core/findings';
import type { EvidenceLocation } from '../core/types';

const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

type IfdKind = 'ifd0' | 'exif' | 'gps' | 'ifd1' | 'interop';

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Offset of the value inside the TIFF region. */
  valueOffset: number;
  size: number;
  entryOffset: number;
}

export interface ExifResult {
  /** True when a valid TIFF header was found. */
  valid: boolean;
  orientation: number | null;
  malformed: boolean;
  thumbnail: { offset: number; length: number; looksLikeJpeg: boolean } | null;
  /** Count of entries seen in total (itemised or not). */
  entryCount: number;
}

const GPS_NAMES: Record<number, string> = {
  0x07: 'time stamp',
  0x0b: 'dilution of precision',
  0x0c: 'speed unit',
  0x0d: 'speed',
  0x0e: 'track reference',
  0x0f: 'track',
  0x10: 'direction reference',
  0x11: 'direction',
  0x12: 'map datum',
  0x1b: 'processing method',
  0x1c: 'area information',
  0x1d: 'date stamp',
  0x1e: 'differential',
  0x1f: 'positioning error',
};

/**
 * Parse a TIFF/EXIF region (starting at the TIFF header, i.e. after the "Exif\0\0" prefix for JPEG).
 * `fileBase` is the absolute file offset of the first byte of `tiff`, used for evidence locations.
 * Reads are bounds-checked; loops, depth and entry counts are bounded.
 */
export function parseExif(tiff: Uint8Array, fileBase: number, sink: FindingSink, where: string): ExifResult {
  const result: ExifResult = {
    valid: false,
    orientation: null,
    malformed: false,
    thumbnail: null,
    entryCount: 0,
  };
  const r = new Reader(tiff);
  if (!r.has(0, 8)) {
    result.malformed = true;
    return result;
  }
  const b0 = r.u8(0);
  const b1 = r.u8(1);
  const le = b0 === 0x49 && b1 === 0x49;
  if (!le && !(b0 === 0x4d && b1 === 0x4d)) {
    result.malformed = true;
    return result;
  }
  if (r.u16(2, le) !== 42) {
    result.malformed = true;
    return result;
  }
  result.valid = true;

  const loc = (offset: number, length: number): EvidenceLocation => ({
    kind: 'bytes',
    offset: fileBase + offset,
    length,
  });

  const queue: Array<{ offset: number; kind: IfdKind }> = [{ offset: r.u32(4, le), kind: 'ifd0' }];
  const visited = new Set<number>();
  let ifdCount = 0;
  let unitemised = 0;
  const gps: Map<number, Entry> = new Map();
  let thumbOffset: Entry | null = null;
  let thumbLength: Entry | null = null;

  const readEntryBytes = (e: Entry): Uint8Array | null => {
    if (e.size > LIMITS.maxTagValueBytes) return null;
    if (!r.has(e.valueOffset, e.size)) return null;
    return r.slice(e.valueOffset, e.size);
  };
  const readAscii = (e: Entry): string | null => {
    if (e.type !== 2 && e.type !== 7 && e.type !== 1) return null;
    const bytes = readEntryBytes(e);
    if (!bytes) return null;
    let end = bytes.indexOf(0);
    if (end === -1) end = bytes.length;
    return utf8(bytes.subarray(0, end)).trim();
  };
  const readShort = (e: Entry): number | null => {
    if ((e.type !== 3 && e.type !== 4) || e.count < 1) return null;
    return e.type === 3 ? r.u16(e.valueOffset, le) : r.u32(e.valueOffset, le);
  };
  const readLong = (e: Entry): number | null => {
    if ((e.type !== 3 && e.type !== 4) || e.count < 1) return null;
    return e.type === 3 ? r.u16(e.valueOffset, le) : r.u32(e.valueOffset, le);
  };
  const readRationals = (e: Entry, n: number): number[] | null => {
    if ((e.type !== 5 && e.type !== 10) || e.count < n || !r.has(e.valueOffset, n * 8)) return null;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const num = e.type === 5 ? r.u32(e.valueOffset + i * 8, le) : r.i32(e.valueOffset + i * 8, le);
      const den = e.type === 5 ? r.u32(e.valueOffset + i * 8 + 4, le) : r.i32(e.valueOffset + i * 8 + 4, le);
      if (den === 0) return null;
      out.push(num / den);
    }
    return out;
  };

  const text = (
    code: string,
    e: Entry,
    tagName: string,
    kind: string,
    normalise?: (s: string) => string,
  ): void => {
    const s = readAscii(e);
    if (s === null) return;
    if (s === '') return;
    sink.add(code, {
      value: normalise ? normalise(s) : s,
      source: `${where}, ${kind} tag 0x${e.tag.toString(16).padStart(4, '0')} (${tagName})`,
      location: loc(e.valueOffset, e.size),
    });
  };

  const exifDate = (s: string): string => {
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(s);
    return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : s;
  };

  while (queue.length > 0) {
    const { offset, kind } = queue.shift()!;
    if (offset === 0) continue;
    if (visited.has(offset)) {
      result.malformed = true; // loop or reuse of an IFD offset
      continue;
    }
    visited.add(offset);
    if (++ifdCount > LIMITS.maxIfds) {
      result.malformed = true;
      break;
    }
    if (!r.has(offset, 2)) {
      result.malformed = true;
      continue;
    }
    const n = r.u16(offset, le);
    if (n > LIMITS.maxIfdEntries || !r.has(offset + 2, n * 12)) {
      result.malformed = true;
      continue;
    }
    const kindLabel = kind === 'ifd0' ? 'IFD0' : kind === 'exif' ? 'Exif IFD' : kind === 'gps' ? 'GPS IFD' : kind === 'ifd1' ? 'IFD1' : 'Interop IFD';
    for (let i = 0; i < n; i++) {
      const eo = offset + 2 + i * 12;
      const tag = r.u16(eo, le);
      const type = r.u16(eo + 2, le);
      const count = r.u32(eo + 4, le);
      const unit = TYPE_SIZE[type];
      result.entryCount++;
      if (unit === undefined || unit === 0) {
        unitemised++;
        continue;
      }
      const size = unit * count;
      const valueOffset = size <= 4 ? eo + 8 : r.u32(eo + 8, le);
      const e: Entry = { tag, type, count, valueOffset, size, entryOffset: eo };
      if (size > 4 && !r.has(valueOffset, size)) {
        result.malformed = true;
        unitemised++;
        continue;
      }
      try {
        if (kind === 'gps') {
          gps.set(tag, e);
          continue;
        }
        if (kind === 'ifd1') {
          if (tag === 0x0201) thumbOffset = e;
          else if (tag === 0x0202) thumbLength = e;
          else unitemised++;
          continue;
        }
        if (kind === 'ifd0') {
          switch (tag) {
            case 0x010f: text('exif.make', e, 'Make', kindLabel); continue;
            case 0x0110: text('exif.model', e, 'Model', kindLabel); continue;
            case 0x0131: text('exif.software', e, 'Software', kindLabel); continue;
            case 0x0132: text('exif.datetime', e, 'DateTime', kindLabel, exifDate); continue;
            case 0x013b: text('exif.artist', e, 'Artist', kindLabel); continue;
            case 0x8298: text('exif.copyright', e, 'Copyright', kindLabel); continue;
            case 0x010e: text('exif.description', e, 'ImageDescription', kindLabel); continue;
            case 0x0112: {
              const v = readShort(e);
              if (v !== null && v >= 1 && v <= 8) {
                if (result.orientation === null) result.orientation = v;
                sink.add('exif.orientation', {
                  value: String(v),
                  source: `${where}, ${kindLabel} tag 0x0112 (Orientation)`,
                  location: loc(valueOffset, size),
                });
              } else {
                result.malformed = true;
              }
              continue;
            }
            case 0x8769: {
              const v = readLong(e);
              if (v !== null) queue.push({ offset: v, kind: 'exif' });
              continue;
            }
            case 0x8825: {
              const v = readLong(e);
              if (v !== null) queue.push({ offset: v, kind: 'gps' });
              continue;
            }
            case 0x9c9b:
            case 0x9c9c:
            case 0x9c9d:
            case 0x9c9e:
            case 0x9c9f: {
              const names: Record<number, string> = {
                0x9c9b: 'XPTitle',
                0x9c9c: 'XPComment',
                0x9c9d: 'XPAuthor',
                0x9c9e: 'XPKeywords',
                0x9c9f: 'XPSubject',
              };
              const bytes = readEntryBytes(e);
              if (!bytes) continue;
              const s = utf16le(bytes).replace(/\u0000+$/, '').trim();
              if (s) {
                sink.add('exif.xp-field', {
                  label: `Windows ${names[tag]!.slice(2).toLowerCase()}`,
                  value: s,
                  source: `${where}, ${kindLabel} tag 0x${tag.toString(16)} (${names[tag]})`,
                  location: loc(valueOffset, size),
                  category: tag === 0x9c9d ? 'identity' : 'document-properties',
                });
              }
              continue;
            }
            case 0x0100:
            case 0x0101:
              continue; // ImageWidth/Length inside EXIF are structural and covered by the image header
            default:
              unitemised++;
              continue;
          }
        }
        if (kind === 'exif') {
          switch (tag) {
            case 0x9003: text('exif.datetime-original', e, 'DateTimeOriginal', kindLabel, exifDate); continue;
            case 0x9004: text('exif.datetime-digitized', e, 'DateTimeDigitized', kindLabel, exifDate); continue;
            case 0x9010: case 0x9011: case 0x9012:
              text('exif.timezone-offset', e, tag === 0x9010 ? 'OffsetTime' : tag === 0x9011 ? 'OffsetTimeOriginal' : 'OffsetTimeDigitized', kindLabel);
              continue;
            case 0xa433: text('exif.lens', e, 'LensMake', kindLabel); continue;
            case 0xa434: text('exif.lens', e, 'LensModel', kindLabel); continue;
            case 0xa431: text('exif.serial', e, 'BodySerialNumber', kindLabel); continue;
            case 0xa435: text('exif.serial', e, 'LensSerialNumber', kindLabel); continue;
            case 0xa430: text('exif.owner', e, 'CameraOwnerName', kindLabel); continue;
            case 0xa420: text('exif.unique-id', e, 'ImageUniqueID', kindLabel); continue;
            case 0x927c:
              sink.add('exif.makernote', {
                value: `${size} bytes`,
                source: `${where}, ${kindLabel} tag 0x927C (MakerNote)`,
                location: loc(valueOffset, size),
                status: 'unsupported',
                confidence: 'high',
              });
              continue;
            case 0x9286: {
              const bytes = readEntryBytes(e);
              if (!bytes || bytes.length < 8) continue;
              const id = latin1(bytes.subarray(0, 8)).replace(/\u0000/g, '');
              const body = bytes.subarray(8);
              let s: string | null = null;
              if (id === 'ASCII') s = latin1(body);
              else if (id === 'UNICODE') {
                s = le ? utf16le(body) : new TextDecoder('utf-16be').decode(body);
              } else if (id === '') s = latin1(body);
              s = s === null ? null : s.replace(/\u0000+$/, '').trim();
              if (s) {
                sink.add('exif.user-comment', {
                  value: s,
                  source: `${where}, ${kindLabel} tag 0x9286 (UserComment)`,
                  location: loc(valueOffset, size),
                });
              } else if (s === null) {
                sink.add('exif.user-comment', {
                  value: `Present, in a character set this tool does not decode (${id || 'undefined'})`,
                  source: `${where}, ${kindLabel} tag 0x9286 (UserComment)`,
                  location: loc(valueOffset, size),
                  status: 'unsupported',
                });
              }
              continue;
            }
            case 0xa005: {
              const v = readLong(e);
              if (v !== null) queue.push({ offset: v, kind: 'interop' });
              continue;
            }
            default:
              unitemised++;
              continue;
          }
        }
        unitemised++; // interop IFD and anything else
      } catch (err) {
        if (err instanceof ParseLimitError) {
          result.malformed = true;
          continue;
        }
        throw err;
      }
    }
    // Next IFD pointer (chain). Only IFD0 -> IFD1 is followed.
    if (kind === 'ifd0') {
      const next = r.has(offset + 2 + n * 12, 4) ? r.u32(offset + 2 + n * 12, le) : 0;
      if (next !== 0) queue.push({ offset: next, kind: 'ifd1' });
    }
  }

  // ---- GPS
  if (gps.size > 0) emitGps(gps, readAscii, readRationals, sink, where, loc, result, r, le);

  // ---- thumbnail (IFD1)
  const to = thumbOffset as Entry | null;
  const tl = thumbLength as Entry | null;
  if (to && tl) {
    const off = readLong(to);
    const len = readLong(tl);
    if (off !== null && len !== null && len > 0 && r.has(off, len)) {
      const looksLikeJpeg = r.u8(off) === 0xff && r.has(off, 2) && r.u8(off + 1) === 0xd8;
      result.thumbnail = { offset: fileBase + off, length: len, looksLikeJpeg };
      sink.add('exif.thumbnail', {
        value: `${len} bytes${looksLikeJpeg ? ', JPEG data' : ', data type not recognised'}`,
        source: `${where}, IFD1 tags 0x0201/0x0202 (JPEGInterchangeFormat)`,
        location: loc(off, len),
        confidence: looksLikeJpeg ? 'high' : 'medium',
      });
    } else if (off !== null) {
      result.malformed = true;
    }
  }

  if (unitemised > 0) {
    sink.add('exif.other-tags', {
      value: `${unitemised} field${unitemised === 1 ? '' : 's'}`,
      source: `${where}, all IFDs`,
      status: 'unsupported',
    });
  }
  if (result.malformed) {
    sink.add('exif.malformed', {
      value: null,
      source: where,
      status: 'suspicious',
      confidence: 'medium',
      limitations: ['Reading stopped for the damaged part. Values in it may be missing from this report.'],
    });
  }
  return result;
}

function emitGps(
  gps: Map<number, Entry>,
  readAscii: (e: Entry) => string | null,
  readRationals: (e: Entry, n: number) => number[] | null,
  sink: FindingSink,
  where: string,
  loc: (o: number, l: number) => EvidenceLocation,
  _result: ExifResult,
  r: Reader,
  le: boolean,
): void {
  const latRef = gps.get(1);
  const lat = gps.get(2);
  const lonRef = gps.get(3);
  const lon = gps.get(4);
  if (latRef && lat && lonRef && lon) {
    const lr = readAscii(latRef)?.toUpperCase() ?? '';
    const or = readAscii(lonRef)?.toUpperCase() ?? '';
    const la = readRationals(lat, 3);
    const lo = readRationals(lon, 3);
    const decimal = (v: number[]): number => v[0]! + v[1]! / 60 + v[2]! / 3600;
    const where2 = `${where}, GPS IFD tags 0x0001-0x0004`;
    const entryOffsets = [latRef, lat, lonRef, lon].map((e) => e.entryOffset);
    const lo0 = Math.min(...entryOffsets);
    const location = loc(lo0, Math.max(...entryOffsets) + 12 - lo0);
    if (la && lo && (lr === 'N' || lr === 'S') && (or === 'E' || or === 'W')) {
      const dLat = decimal(la);
      const dLon = decimal(lo);
      const valid = dLat >= 0 && dLat <= 90 && dLon >= 0 && dLon <= 180;
      sink.add('exif.gps-position', {
        value: `${dLat.toFixed(6)}° ${lr}, ${dLon.toFixed(6)}° ${or}`,
        source: where2,
        location,
        status: valid ? 'verified' : 'suspicious',
        limitations: valid ? [] : ['The coordinates are outside the valid range, so they are likely wrong.'],
      });
    } else {
      sink.add('exif.gps-position', {
        value: 'GPS fields are present but could not be decoded into a position',
        source: where2,
        location,
        status: 'suspicious',
        confidence: 'medium',
      });
    }
  } else if (latRef || lat || lonRef || lon) {
    sink.add('exif.gps-position', {
      value: 'Incomplete GPS position fields',
      source: `${where}, GPS IFD`,
      status: 'suspicious',
      confidence: 'medium',
    });
  }
  const altRef = gps.get(5);
  const alt = gps.get(6);
  if (alt) {
    const a = readRationals(alt, 1);
    const below = altRef && altRef.type === 1 && r.has(altRef.valueOffset, 1) && r.u8(altRef.valueOffset) === 1;
    sink.add('exif.gps-altitude', {
      value: a ? `${(below ? -a[0]! : a[0]!).toFixed(1)} m` : 'Present, not decodable',
      source: `${where}, GPS IFD tags 0x0005-0x0006`,
      location: loc(alt.valueOffset, alt.size),
      status: a ? 'verified' : 'suspicious',
    });
  }
  const others: string[] = [];
  for (const [tag, name] of Object.entries(GPS_NAMES)) {
    const e = gps.get(Number(tag));
    if (!e) continue;
    if (Number(tag) === 0x1d) {
      const d = readAscii(e);
      others.push(`${name}: ${d ?? 'not decodable'}`);
    } else if (Number(tag) === 0x07) {
      const t = readRationals(e, 3);
      others.push(`${name}: ${t ? t.map((x) => String(Math.round(x)).padStart(2, '0')).join(':') + ' UTC' : 'not decodable'}`);
    } else if (Number(tag) === 0x11 || Number(tag) === 0x0f || Number(tag) === 0x0d) {
      const v = readRationals(e, 1);
      others.push(`${name}: ${v ? v[0]!.toFixed(1) : 'not decodable'}`);
    } else {
      others.push(name);
    }
  }
  void le;
  if (others.length > 0) {
    sink.add('exif.gps-other', {
      value: others.join('; '),
      source: `${where}, GPS IFD`,
    });
  }
}
