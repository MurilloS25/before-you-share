import { Reader, latin1, utf8, displayText } from '../core/bytes';
import { crc32 } from '../core/crc32';
import { LIMITS } from '../core/limits';
import { FindingSink } from '../core/findings';
import type { CoverageItem, Dimensions } from '../core/types';
import { parseExif } from './exif';
import { analyseXmp } from './xmp';
import { parseIccHeader } from './icc';
import { inflateBounded } from './inflate';
import type { FormatAnalysis } from './common';
import { imageSizeRefusal } from './common';
import { describeTrailing } from './jpeg';

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface PngChunk {
  type: string;
  /** Offset of the 4-byte length field. */
  offset: number;
  length: number;
  dataOffset: number;
  /** Total bytes of the chunk: 12 + length. */
  total: number;
  crcOk: boolean;
}

export interface PngScan {
  chunks: PngChunk[];
  signatureOk: boolean;
  /** Offset just after the IEND chunk, when found. */
  iendEnd: number | null;
  truncated: boolean;
  invalid: string | null;
  limitHit: boolean;
  dimensions: Dimensions | null;
  ihdrValid: boolean;
  /** Per-chunk ordering issues, plain language, no file-derived text. */
  orderIssues: string[];
  /** Order issues that make the file structurally unsound for copying. */
  fatalOrder: boolean;
  interlace: number | null;
}

const VALID_DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const SINGLE = new Set(['cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'mDCV', 'cLLI', 'bKGD', 'hIST', 'tRNS', 'pHYs', 'tIME', 'eXIf', 'PLTE', 'IHDR', 'acTL']);
const BEFORE_PLTE = new Set(['cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'mDCV', 'cLLI']);

const isLetter = (b: number): boolean => (b >= 65 && b <= 90) || (b >= 97 && b <= 122);

export function scanPng(bytes: Uint8Array): PngScan {
  const n = bytes.length;
  const scan: PngScan = {
    chunks: [],
    signatureOk: false,
    iendEnd: null,
    truncated: false,
    invalid: null,
    limitHit: false,
    dimensions: null,
    ihdrValid: false,
    orderIssues: [],
    fatalOrder: false,
    interlace: null,
  };
  scan.signatureOk = n >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
  if (!scan.signatureOk) {
    scan.invalid = 'Missing PNG signature.';
    return scan;
  }
  const r = new Reader(bytes);
  let pos = 8;
  while (pos < n) {
    if (pos + 8 > n) {
      scan.truncated = true;
      break;
    }
    if (scan.chunks.length >= LIMITS.maxPngChunks) {
      scan.limitHit = true;
      break;
    }
    const length = r.u32(pos);
    if (length > 0x7fffffff) {
      scan.invalid = 'A chunk declares a length above the PNG maximum.';
      break;
    }
    if (!isLetter(bytes[pos + 4]!) || !isLetter(bytes[pos + 5]!) || !isLetter(bytes[pos + 6]!) || !isLetter(bytes[pos + 7]!)) {
      scan.invalid = 'A chunk has an invalid type code.';
      break;
    }
    const total = 12 + length;
    if (pos + total > n) {
      scan.truncated = true;
      break;
    }
    const type = latin1(bytes.subarray(pos + 4, pos + 8));
    const crcOk = crc32(bytes, pos + 4, pos + 8 + length) === r.u32(pos + 8 + length);
    scan.chunks.push({ type, offset: pos, length, dataOffset: pos + 8, total, crcOk });
    pos += total;
    if (type === 'IEND') {
      scan.iendEnd = pos;
      break;
    }
  }
  validatePng(bytes, scan);
  return scan;
}

function validatePng(bytes: Uint8Array, scan: PngScan): void {
  const r = new Reader(bytes);
  const first = scan.chunks[0];
  if (!first || first.type !== 'IHDR') {
    if (!scan.invalid && first) scan.orderIssues.push('The first chunk is not IHDR.');
    if (first) scan.fatalOrder = true;
  } else if (first.length !== 13) {
    scan.orderIssues.push('The IHDR chunk has an unexpected length.');
    scan.fatalOrder = true;
  } else {
    const w = r.u32(first.dataOffset);
    const h = r.u32(first.dataOffset + 4);
    const depth = r.u8(first.dataOffset + 8);
    const ct = r.u8(first.dataOffset + 9);
    const comp = r.u8(first.dataOffset + 10);
    const filt = r.u8(first.dataOffset + 11);
    const il = r.u8(first.dataOffset + 12);
    scan.interlace = il;
    const okDims = w > 0 && h > 0 && w <= 0x7fffffff && h <= 0x7fffffff;
    const okCombo = (VALID_DEPTHS[ct] ?? []).includes(depth) && comp === 0 && filt === 0 && (il === 0 || il === 1);
    if (okDims) scan.dimensions = { width: w, height: h };
    scan.ihdrValid = okDims && okCombo;
    if (!scan.ihdrValid) scan.orderIssues.push('The IHDR chunk contains invalid values.');
    if (!scan.ihdrValid) scan.fatalOrder = true;
  }
  const seen = new Map<string, number>();
  let idatState: 'before' | 'in' | 'after' = 'before';
  let plteSeen = false;
  for (const c of scan.chunks) {
    seen.set(c.type, (seen.get(c.type) ?? 0) + 1);
    if (SINGLE.has(c.type) && seen.get(c.type)! > 1 && scan.orderIssues.length < 30) {
      scan.orderIssues.push(`The ${c.type} chunk appears more than once.`);
      if (c.type === 'IHDR' || c.type === 'PLTE') scan.fatalOrder = true;
    }
    if (c.type === 'IDAT') {
      if (idatState === 'after') {
        scan.orderIssues.push('IDAT chunks are not consecutive.');
        scan.fatalOrder = true;
      }
      idatState = 'in';
    } else if (idatState === 'in' && c.type !== 'fdAT') {
      idatState = 'after';
    }
    if (c.type === 'PLTE') {
      if (idatState !== 'before') {
        scan.orderIssues.push('PLTE appears after image data.');
        scan.fatalOrder = true;
      }
      plteSeen = true;
    }
    if (BEFORE_PLTE.has(c.type) && (plteSeen || idatState !== 'before') && scan.orderIssues.length < 30) {
      scan.orderIssues.push(`The ${c.type} chunk appears later than the specification allows.`);
    }
    if (c.type === 'IEND' && c.length !== 0) scan.orderIssues.push('IEND has data.');
  }
  if (!seen.has('IDAT') && scan.iendEnd !== null) {
    scan.orderIssues.push('No IDAT image data chunk was found.');
    scan.fatalOrder = true;
  }
  if (seen.has('iCCP') && seen.has('sRGB')) scan.orderIssues.push('Both iCCP and sRGB colour chunks are present.');
}

export type PngChunkKind = 'critical' | 'render' | 'text' | 'exif' | 'time' | 'unknown-ancillary' | 'unknown-critical';
export interface ChunkClass {
  kind: PngChunkKind;
  group: string | null;
  alwaysKeep: boolean;
}

const RENDER = new Set(['tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'hIST', 'pHYs', 'sPLT', 'cICP', 'mDCV', 'cLLI', 'acTL', 'fcTL', 'fdAT']);

/** Policy table for PNG chunks, shared by analysis and transformation. */
export function classifyChunk(type: string): ChunkClass {
  if (type === 'IHDR' || type === 'PLTE' || type === 'IDAT' || type === 'IEND') return { kind: 'critical', group: null, alwaysKeep: true };
  if (RENDER.has(type)) return { kind: 'render', group: null, alwaysKeep: true };
  if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') return { kind: 'text', group: 'png-text', alwaysKeep: false };
  if (type === 'eXIf') return { kind: 'exif', group: 'png-exif', alwaysKeep: false };
  if (type === 'tIME') return { kind: 'time', group: 'png-time', alwaysKeep: false };
  const ancillary = type.charCodeAt(0) >= 97;
  return ancillary
    ? { kind: 'unknown-ancillary', group: 'png-unknown', alwaysKeep: false }
    : { kind: 'unknown-critical', group: null, alwaysKeep: true };
}

const KNOWN_PRIVATE: Record<string, string> = {
  caBX: 'Associated by name with C2PA / Content Credentials provenance data',
  iDOT: 'Associated by name with an Apple image-decoding optimisation',
};

function splitKeyword(data: Uint8Array): { keyword: string; rest: number } | null {
  const nul = data.indexOf(0);
  if (nul < 1 || nul > 79) return null;
  return { keyword: latin1(data.subarray(0, nul)), rest: nul + 1 };
}

export async function analysePng(bytes: Uint8Array): Promise<FormatAnalysis> {
  const sink = new FindingSink();
  const scan = scanPng(bytes);
  const r = new Reader(bytes);
  let inflateBudget: number = LIMITS.maxInflateTotal;
  let orientation: number | null = null;
  const renderChunks = new Set<string>();
  let apngFrames = 0;
  let hasApng = false;
  let crcBad = 0;
  let criticalCrcBad = false;
  let unknownCriticalSeen = false;

  const inflateCapped = async (data: Uint8Array, cap: number) => {
    const res = await inflateBounded(data, Math.min(cap, Math.max(inflateBudget, 0)));
    inflateBudget -= res.bytes.length;
    return res;
  };

  for (const c of scan.chunks) {
    const cls = classifyChunk(c.type);
    const loc = { kind: 'bytes' as const, offset: c.offset, length: c.total };
    if (!c.crcOk) {
      crcBad++;
      if (cls.kind === 'critical') criticalCrcBad = true;
      if (crcBad <= 20) {
        sink.add('png.crc-invalid', {
          value: `${c.type} chunk`,
          source: `PNG chunk ${c.type}`,
          location: loc,
          status: 'suspicious',
          group: null,
        });
      }
    }
    const data = bytes.subarray(c.dataOffset, c.dataOffset + c.length);
    const at = `PNG ${c.type} chunk`;
    const mark = sink.findings.length;
    switch (c.type) {
      case 'tEXt': {
        const kw = splitKeyword(data);
        if (!kw) break;
        emitText(sink, kw.keyword, latin1(data.subarray(kw.rest)), at, loc, 'verified');
        break;
      }
      case 'zTXt': {
        const kw = splitKeyword(data);
        if (!kw || data.length < kw.rest + 1) break;
        const res = await inflateCapped(data.subarray(kw.rest + 1), LIMITS.maxInflatePerChunk);
        emitText(sink, kw.keyword, latin1(res.bytes), at, loc, res.truncated || res.error ? 'suspicious' : 'verified', res.truncated, res.error);
        break;
      }
      case 'iTXt': {
        const kw = splitKeyword(data);
        if (!kw || data.length < kw.rest + 2) break;
        const flag = data[kw.rest]!;
        const method = data[kw.rest + 1]!;
        let p = kw.rest + 2;
        const langEnd = data.indexOf(0, p);
        if (langEnd === -1) break;
        p = langEnd + 1;
        const transEnd = data.indexOf(0, p);
        if (transEnd === -1) break;
        p = transEnd + 1;
        const body = data.subarray(p);
        let text: Uint8Array = body;
        let truncated = false;
        let error = false;
        if (flag === 1) {
          if (method !== 0) {
            error = true;
            text = new Uint8Array(0);
          } else {
            const cap = kw.keyword === 'XML:com.adobe.xmp' ? LIMITS.maxXmpBytes : LIMITS.maxInflatePerChunk;
            const res = await inflateCapped(body, cap);
            text = res.bytes;
            truncated = res.truncated;
            error = res.error;
          }
        }
        if (kw.keyword === 'XML:com.adobe.xmp') {
          analyseXmp(text, sink, at, loc);
        } else {
          emitText(sink, kw.keyword, utf8(text), at, loc, truncated || error ? 'suspicious' : 'verified', truncated, error);
        }
        break;
      }
      case 'eXIf': {
        const res = parseExif(data, c.dataOffset, sink, at);
        if (res.orientation !== null) orientation = res.orientation;
        break;
      }
      case 'tIME': {
        if (c.length === 7) {
          const y = r.u16(c.dataOffset);
          const mo = data[2]!;
          const d = data[3]!;
          const h = data[4]!;
          const mi = data[5]!;
          const s = data[6]!;
          const ok = mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59 && s <= 60;
          const p2 = (v: number): string => String(v).padStart(2, '0');
          sink.add('png.time', {
            value: `${String(y).padStart(4, '0')}-${p2(mo)}-${p2(d)} ${p2(h)}:${p2(mi)}:${p2(s)} UTC`,
            source: at,
            location: loc,
            status: ok ? 'verified' : 'suspicious',
          });
        } else {
          sink.add('png.time', { value: 'tIME chunk has an unexpected length', source: at, location: loc, status: 'suspicious' });
        }
        break;
      }
      case 'pHYs': {
        if (c.length === 9) {
          const x = r.u32(c.dataOffset);
          const y = r.u32(c.dataOffset + 4);
          const unit = data[8]!;
          sink.add('png.phys', {
            value: unit === 1 ? `${x} × ${y} pixels per metre (about ${Math.round(x * 0.0254)} × ${Math.round(y * 0.0254)} dpi)` : `${x}:${y} aspect ratio only`,
            source: at,
            location: loc,
          });
        }
        renderChunks.add('pHYs');
        break;
      }
      case 'iCCP': {
        const kw = splitKeyword(data);
        if (!kw || data.length < kw.rest + 1) break;
        const res = await inflateCapped(data.subarray(kw.rest + 1), LIMITS.maxInflatePerChunk);
        const icc = parseIccHeader(res.bytes);
        sink.add('icc.profile', {
          value: icc
            ? [icc.description ?? `profile name "${displayText(kw.keyword, 60)}"`, `${icc.colorSpace} ${icc.deviceClass}`, `ICC ${icc.version}`, icc.created ? `profile dated ${icc.created}` : null].filter(Boolean).join(', ')
            : `Profile named "${displayText(kw.keyword, 60)}" could not be decoded`,
          source: at,
          location: loc,
          status: icc ? 'verified' : 'suspicious',
          confidence: icc ? 'high' : 'medium',
        });
        renderChunks.add('iCCP');
        break;
      }
      case 'acTL': {
        hasApng = true;
        if (c.length === 8) apngFrames = r.u32(c.dataOffset);
        break;
      }
      default: {
        if (cls.kind === 'render') renderChunks.add(c.type);
        else if (cls.kind === 'unknown-ancillary' || cls.kind === 'unknown-critical') {
          if (cls.kind === 'unknown-critical') unknownCriticalSeen = true;
          const known = KNOWN_PRIVATE[c.type];
          if (known) {
            sink.add('png.known-private', {
              value: `${c.type}, ${c.length} bytes. ${known}.`,
              source: at,
              location: loc,
              status: 'inferred',
              confidence: 'medium',
            });
          } else {
            sink.add('png.unknown-chunk', {
              value: `${c.type}, ${c.length} bytes${cls.kind === 'unknown-critical' ? ' (critical)' : ''}`,
              source: at,
              location: loc,
              status: 'unsupported',
              group: cls.kind === 'unknown-critical' ? null : undefined,
              transformation: cls.kind === 'unknown-critical' ? 'preserved' : undefined,
            });
          }
        }
      }
    }
    // Re-home findings that came from shared helpers into this format's removal options.
    for (let i = mark; i < sink.findings.length; i++) {
      const f = sink.findings[i]!;
      if (f.group === 'exif') f.group = 'png-exif';
      else if (f.group === 'xmp') f.group = 'png-text';
    }
  }

  const displayChunks = [...renderChunks].filter((t) => t !== 'iCCP' && t !== 'pHYs');
  if (displayChunks.length > 0) {
    sink.add('png.render-chunk', { value: displayChunks.join(', '), source: 'PNG ancillary chunks that affect display' });
  }
  if (hasApng) {
    sink.add('png.apng', { value: `${apngFrames} frame${apngFrames === 1 ? '' : 's'} declared`, source: 'PNG acTL chunk' });
  }
  if (crcBad > 20) {
    sink.add('png.crc-invalid', { value: `${crcBad} chunks in total`, source: 'PNG chunk checksums', status: 'suspicious', group: null });
  }

  const trailing = scan.iendEnd !== null ? bytes.length - scan.iendEnd : 0;
  if (scan.iendEnd !== null && trailing > 0) {
    sink.add('png.trailing-data', {
      value: `${trailing} bytes${describeTrailing(bytes, scan.iendEnd)}`,
      source: 'Bytes after the PNG IEND chunk',
      location: { kind: 'bytes', offset: scan.iendEnd, length: trailing },
      status: 'suspicious',
    });
  }
  if (scan.truncated || (scan.iendEnd === null && !scan.invalid && !scan.limitHit)) {
    sink.add('png.truncated', { value: null, source: 'PNG chunk walk', status: 'suspicious' });
  }
  if (scan.invalid) sink.add('png.invalid', { value: scan.invalid, source: 'PNG chunk walk', status: 'suspicious' });
  if (scan.limitHit) sink.add('png.limit', { value: `More than ${LIMITS.maxPngChunks} chunks`, source: 'Safety limit', status: 'unsupported' });
  for (const issue of scan.orderIssues.slice(0, 20)) {
    sink.add('png.order', { value: issue, source: 'PNG chunk order rules', status: 'suspicious', confidence: 'medium' });
  }
  if (inflateBudget <= 0) {
    sink.add('png.limit', { value: 'Total decompression budget reached; some compressed text was not read', source: 'Safety limit', status: 'unsupported' });
  }

  const dims = scan.dimensions;
  if (dims) {
    sink.add('image.dimensions', {
      value: `${dims.width} × ${dims.height} pixels${scan.interlace === 1 ? ', interlaced' : ''}`,
      source: 'PNG IHDR chunk',
      location: scan.chunks[0] ? { kind: 'bytes', offset: scan.chunks[0].offset, length: scan.chunks[0].total } : undefined,
    });
  }
  const refusal = imageSizeRefusal(dims);
  if (refusal) {
    sink.add('image.extreme-dimensions', { value: dims ? `${dims.width} × ${dims.height} pixels` : null, source: 'PNG IHDR chunk', status: 'suspicious' });
  }

  const unsound =
    scan.truncated ||
    scan.invalid !== null ||
    scan.limitHit ||
    scan.iendEnd === null ||
    !scan.ihdrValid ||
    scan.fatalOrder ||
    criticalCrcBad ||
    unknownCriticalSeen;
  let copyRefusal: string | null = null;
  if (unsound) copyRefusal = 'The PNG structure is damaged, incomplete or unusual, so a copy could not be checked reliably.';
  else if (refusal) copyRefusal = refusal;

  const coverage: CoverageItem[] = [
    { area: 'PNG chunk structure', state: scan.limitHit || scan.invalid || scan.truncated ? 'partial' : 'inspected', note: 'Every chunk header, length and checksum was examined; image data was not decoded.' },
    { area: 'Text entries', state: 'partial', note: 'tEXt, zTXt and iTXt entries were read; compressed text is limited to a safe size.' },
    { area: 'EXIF and XMP', state: 'partial', note: 'Common EXIF fields and well-known XMP properties were extracted.' },
    { area: 'Colour profile', state: 'partial', note: 'Only the profile header and description were read.' },
    { area: 'Unrecognised chunks', state: 'not-inspected', note: 'Chunks this tool does not know are listed with name and size, not decoded.' },
    { area: 'Image content', state: 'not-inspected', note: 'The picture itself is not analysed, and data hidden in pixels is not examined.' },
  ];
  sink.coverage.push(...coverage);
  return {
    findings: sink.findings,
    coverage: sink.coverage,
    dimensions: dims,
    orientation,
    structurallyUnsound: unsound,
    copyRefusal,
  };
}

function emitText(
  sink: FindingSink,
  keyword: string,
  text: string,
  at: string,
  loc: { kind: 'bytes'; offset: number; length: number },
  status: 'verified' | 'suspicious',
  truncated = false,
  error = false,
): void {
  const k = keyword.toLowerCase();
  const code = k === 'author' ? 'png.text-author' : k === 'software' ? 'png.text-software' : k === 'creation time' ? 'png.text-time' : 'png.text';
  const limitations: string[] = [];
  if (truncated) limitations.push('The decompressed text exceeded the safety limit and was cut. This can indicate a decompression bomb.');
  if (error) limitations.push('The compressed text could not be fully decoded.');
  sink.add(code, {
    label: code === 'png.text' ? `Text entry “${displayText(keyword, 60)}”` : undefined,
    value: text,
    source: at,
    location: loc,
    status,
    limitations,
  });
}
