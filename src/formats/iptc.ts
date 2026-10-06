import { Reader, latin1, utf8 } from '../core/bytes';
import { LIMITS } from '../core/limits';
import type { FindingSink } from '../core/findings';
import type { EvidenceLocation } from '../core/types';

/** IPTC-IIM datasets (record 2) mapped to catalogue codes. */
const DATASETS: Record<number, { code: string; label: string }> = {
  5: { code: 'iptc.headline', label: 'Object name (IPTC)' },
  25: { code: 'iptc.keywords', label: 'Keywords (IPTC)' },
  55: { code: 'iptc.date', label: 'Date created (IPTC)' },
  60: { code: 'iptc.date', label: 'Time created (IPTC)' },
  80: { code: 'iptc.byline', label: 'Creator (IPTC)' },
  90: { code: 'iptc.location', label: 'City (IPTC)' },
  92: { code: 'iptc.location', label: 'Sub-location (IPTC)' },
  95: { code: 'iptc.location', label: 'Region (IPTC)' },
  101: { code: 'iptc.location', label: 'Country (IPTC)' },
  105: { code: 'iptc.headline', label: 'Headline (IPTC)' },
  110: { code: 'iptc.credit', label: 'Credit (IPTC)' },
  115: { code: 'iptc.credit', label: 'Source (IPTC)' },
  116: { code: 'iptc.copyright', label: 'Copyright (IPTC)' },
  120: { code: 'iptc.caption', label: 'Caption (IPTC)' },
  122: { code: 'iptc.byline', label: 'Caption writer (IPTC)' },
};

export interface PhotoshopResult {
  resources: number;
  iptcDatasets: number;
  thumbnails: number;
}

/**
 * Parse a Photoshop "8BIM" resource block (the body of a JPEG APP13 after "Photoshop 3.0\0").
 * IPTC-NAA (0x0404) datasets are itemised; thumbnails are noted; all other resources are counted.
 */
export function parsePhotoshopBlock(
  body: Uint8Array,
  fileBase: number,
  sink: FindingSink,
  where: string,
): PhotoshopResult {
  const r = new Reader(body);
  const result: PhotoshopResult = { resources: 0, iptcDatasets: 0, thumbnails: 0 };
  let o = 0;
  while (r.has(o, 12) && r.startsWithAscii(o, '8BIM') && result.resources < 512) {
    const id = r.u16(o + 4);
    // Pascal string name, padded to even length including the length byte.
    const nameLen = r.u8(o + 6);
    let p = o + 6 + 1 + nameLen;
    if ((nameLen + 1) % 2 === 1) p += 1;
    if (!r.has(p, 4)) break;
    const size = r.u32(p);
    const dataStart = p + 4;
    if (!r.has(dataStart, size)) break;
    result.resources++;
    const loc: EvidenceLocation = { kind: 'bytes', offset: fileBase + dataStart, length: size };
    if (id === 0x0404) {
      result.iptcDatasets += parseIptc(r.slice(dataStart, size), fileBase + dataStart, sink, where);
    } else if (id === 0x0409 || id === 0x040c) {
      result.thumbnails++;
      sink.add('photoshop.thumbnail', {
        value: `${size} bytes`,
        source: `${where}, 8BIM resource 0x${id.toString(16).padStart(4, '0')}`,
        location: loc,
      });
    }
    o = dataStart + size + (size % 2);
  }
  return result;
}

export function parseIptc(data: Uint8Array, fileBase: number, sink: FindingSink, where: string): number {
  const r = new Reader(data);
  let o = 0;
  let count = 0;
  let other = 0;
  const utf8Declared = findCodedCharset(data);
  while (r.has(o, 5) && r.u8(o) === 0x1c && count < LIMITS.maxIptcDatasets) {
    const record = r.u8(o + 1);
    const dataset = r.u8(o + 2);
    let len = r.u16(o + 3);
    let start = o + 5;
    if (len & 0x8000) {
      // Extended dataset: the low 15 bits give the number of length bytes.
      const n = len & 0x7fff;
      if (n > 4 || !r.has(start, n)) break;
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + r.u8(start + i);
      start += n;
    }
    if (!r.has(start, len)) break;
    count++;
    if (record === 2) {
      const spec = DATASETS[dataset];
      if (spec) {
        const raw = r.slice(start, len);
        const text = utf8Declared ? utf8(raw) : looksUtf8(raw) ? utf8(raw) : latin1(raw);
        if (text.trim()) {
          sink.add(spec.code, {
            label: spec.label,
            value: text.trim(),
            source: `${where}, IPTC dataset 2:${String(dataset).padStart(2, '0')}`,
            location: { kind: 'bytes', offset: fileBase + start, length: len },
          });
        }
      } else {
        other++;
      }
    }
    o = start + len;
  }
  if (other > 0) {
    sink.add('iptc.other', {
      value: `${other} dataset${other === 1 ? '' : 's'}`,
      source: `${where}, IPTC record 2`,
      status: 'unsupported',
    });
  }
  return count;
}

function findCodedCharset(data: Uint8Array): boolean {
  // Dataset 1:90 = ESC % G means UTF-8.
  const r = new Reader(data);
  let o = 0;
  let n = 0;
  while (r.has(o, 5) && r.u8(o) === 0x1c && n++ < LIMITS.maxIptcDatasets) {
    const record = r.u8(o + 1);
    const dataset = r.u8(o + 2);
    const len = r.u16(o + 3);
    if (len & 0x8000 || !r.has(o + 5, len)) return false;
    if (record === 1 && dataset === 90) {
      const b = r.slice(o + 5, len);
      return b.length >= 3 && b[0] === 0x1b && b[1] === 0x25 && b[2] === 0x47;
    }
    o += 5 + len;
  }
  return false;
}

function looksUtf8(b: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}
