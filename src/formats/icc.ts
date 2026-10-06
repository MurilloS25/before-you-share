import { Reader, latin1, utf16le } from '../core/bytes';

export interface IccSummary {
  size: number;
  colorSpace: string;
  deviceClass: string;
  version: string;
  description: string | null;
  created: string | null;
}

const CLASS: Record<string, string> = {
  scnr: 'input device',
  mntr: 'display',
  prtr: 'output device',
  link: 'device link',
  spac: 'color space conversion',
  abst: 'abstract',
  nmcl: 'named color',
};

/**
 * Parse an ICC profile header (ICC.1) and its first 'desc' tag. Purely informational:
 * the profile is never applied or modified. Returns null if the header is not plausible.
 * `bytes` may be truncated (the first part of the profile is enough).
 */
export function parseIccHeader(bytes: Uint8Array): IccSummary | null {
  const r = new Reader(bytes);
  if (!r.has(0, 132)) return null;
  if (!r.startsWithAscii(36, 'acsp')) return null;
  const declared = r.u32(0);
  const major = r.u8(8);
  const minor = r.u8(9) >> 4;
  const cls = latin1(r.slice(12, 4));
  const space = latin1(r.slice(16, 4)).trim();
  const year = r.u16(24);
  const month = r.u16(26);
  const day = r.u16(28);
  const created =
    year >= 1990 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31
      ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : null;
  let description: string | null = null;
  const tagCount = r.u32(128);
  if (tagCount <= 200 && r.has(132, tagCount * 12)) {
    for (let i = 0; i < tagCount; i++) {
      const o = 132 + i * 12;
      if (r.startsWithAscii(o, 'desc')) {
        const off = r.u32(o + 4);
        const size = r.u32(o + 8);
        if (size >= 12 && size < 1_000_000 && r.has(off, Math.min(size, 12))) {
          description = readDesc(r, off, size);
        }
        break;
      }
    }
  }
  return {
    size: declared,
    colorSpace: space,
    deviceClass: CLASS[cls] ?? cls,
    version: `${major}.${minor}`,
    description,
    created,
  };
}

function readDesc(r: Reader, off: number, size: number): string | null {
  const type = latin1(r.slice(off, 4));
  try {
    if (type === 'desc') {
      const n = r.u32(off + 8);
      if (n > 0 && n <= 256 && r.has(off + 12, Math.min(n, 1))) {
        const len = Math.min(n, Math.max(0, r.length - (off + 12)), size - 12);
        return latin1(r.slice(off + 12, Math.max(0, len))).replace(/\u0000.*$/s, '').trim() || null;
      }
    } else if (type === 'mluc') {
      const count = r.u32(off + 8);
      if (count >= 1 && count <= 32 && r.has(off + 16, 12)) {
        const len = r.u32(off + 20);
        const so = r.u32(off + 24);
        if (len <= 512 && r.has(off + so, len)) {
          const be = r.slice(off + so, len);
          const swapped = new Uint8Array(be.length);
          for (let i = 0; i + 1 < be.length; i += 2) {
            swapped[i] = be[i + 1]!;
            swapped[i + 1] = be[i]!;
          }
          return utf16le(swapped).trim() || null;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}
