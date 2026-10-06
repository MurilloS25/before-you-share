import { Reader, utf8 } from '../core/bytes';
import { LIMITS } from '../core/limits';
import { inflateBounded } from './inflate';

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  crc: number;
  localOffset: number;
}

export interface ZipDirectory {
  entries: ZipEntry[];
  /** No end-of-central-directory record, or the directory points outside the file. */
  invalid: string | null;
  zip64: boolean;
  limitHit: boolean;
  /** Declared sum of uncompressed sizes (not trusted; used only to flag suspicious archives). */
  declaredUncompressed: number;
}

const EOCD = 0x06054b50;
const CDH = 0x02014b50;
const LFH = 0x04034b50;

/**
 * Read the ZIP central directory without extracting anything. Bounded: the end record is searched in the
 * last 64 KiB, entries are capped, every offset is checked against the file, and ZIP64 is reported, not followed.
 */
export function readZipDirectory(bytes: Uint8Array): ZipDirectory {
  const dir: ZipDirectory = { entries: [], invalid: null, zip64: false, limitHit: false, declaredUncompressed: 0 };
  const r = new Reader(bytes);
  const n = bytes.length;
  if (n < 22) {
    dir.invalid = 'Too short to be a ZIP archive.';
    return dir;
  }
  let eocd = -1;
  const stop = Math.max(0, n - 22 - 0xffff);
  for (let i = n - 22; i >= stop; i--) {
    if (bytes[i] === 0x50 && r.u32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) {
    dir.invalid = 'No end-of-central-directory record was found (the file may be truncated).';
    return dir;
  }
  const total = r.u16(eocd + 10, true);
  const cdSize = r.u32(eocd + 12, true);
  const cdOffset = r.u32(eocd + 16, true);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    dir.zip64 = true;
    dir.invalid = 'ZIP64 archives are not supported.';
    return dir;
  }
  if (cdOffset + cdSize > eocd) {
    dir.invalid = 'The central directory points outside the file.';
    return dir;
  }
  let p = cdOffset;
  const end = cdOffset + cdSize;
  while (p + 46 <= end) {
    if (r.u32(p, true) !== CDH) {
      dir.invalid = 'The central directory is damaged.';
      return dir;
    }
    if (dir.entries.length >= LIMITS.maxZipEntries) {
      dir.limitHit = true;
      return dir;
    }
    const flags = r.u16(p + 8, true);
    const method = r.u16(p + 10, true);
    const crc = r.u32(p + 16, true);
    const compressedSize = r.u32(p + 20, true);
    const uncompressedSize = r.u32(p + 24, true);
    const nameLen = r.u16(p + 28, true);
    const extraLen = r.u16(p + 30, true);
    const commentLen = r.u16(p + 32, true);
    const localOffset = r.u32(p + 42, true);
    if (p + 46 + nameLen + extraLen + commentLen > end) {
      dir.invalid = 'A central directory record runs past the directory.';
      return dir;
    }
    const name = utf8(r.slice(p + 46, nameLen));
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) dir.zip64 = true;
    dir.declaredUncompressed += uncompressedSize;
    dir.entries.push({ name, method, flags, compressedSize, uncompressedSize, crc, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return dir;
}

export interface ZipPart {
  bytes: Uint8Array;
  truncated: boolean;
  error: string | null;
}

/** Read one entry's data, capped at `max` bytes after decompression. Never extracts to disk. */
export async function readZipEntry(bytes: Uint8Array, e: ZipEntry, max: number): Promise<ZipPart> {
  const r = new Reader(bytes);
  if (e.flags & 1) return { bytes: new Uint8Array(0), truncated: false, error: 'encrypted' };
  if (!r.has(e.localOffset, 30) || r.u32(e.localOffset, true) !== LFH) return { bytes: new Uint8Array(0), truncated: false, error: 'bad local header' };
  const nameLen = r.u16(e.localOffset + 26, true);
  const extraLen = r.u16(e.localOffset + 28, true);
  const start = e.localOffset + 30 + nameLen + extraLen;
  if (!r.has(start, e.compressedSize)) return { bytes: new Uint8Array(0), truncated: false, error: 'data outside file' };
  const data = bytes.subarray(start, start + e.compressedSize);
  if (e.method === 0) return { bytes: data.subarray(0, max), truncated: data.length > max, error: null };
  if (e.method === 8) {
    const res = await inflateBounded(data, max, 'deflate-raw');
    return { bytes: res.bytes, truncated: res.truncated, error: res.error && !res.truncated ? 'invalid compressed data' : null };
  }
  return { bytes: new Uint8Array(0), truncated: false, error: 'unsupported compression method' };
}
