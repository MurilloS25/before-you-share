import { crc32, deflateSync } from 'node:zlib'; // independent of src/core/crc32 on purpose
import { cat, enc, latin, u32be, syntheticRgba } from './jpeg';

export const PNG_SIG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

export function chunk(type: string, data: Uint8Array, opts: { badCrc?: boolean; lengthOverride?: number } = {}): Uint8Array {
  const t = latin(type);
  const body = cat(t, data);
  let crc = crc32(body) >>> 0;
  if (opts.badCrc) crc = (crc ^ 0xdeadbeef) >>> 0;
  return cat(u32be(opts.lengthOverride ?? data.length), body, u32be(crc));
}

export function ihdr(width: number, height: number, depth = 8, colorType = 2, interlace = 0): Uint8Array {
  return chunk('IHDR', cat(u32be(width), u32be(height), Uint8Array.of(depth, colorType, 0, 0, interlace)));
}

export function idatFor(width: number, height: number): Uint8Array {
  const rgba = syntheticRgba(width, height);
  const raw = new Uint8Array(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[o++] = rgba[i]!;
      raw[o++] = rgba[i + 1]!;
      raw[o++] = rgba[i + 2]!;
    }
  }
  return chunk('IDAT', Uint8Array.from(deflateSync(raw, { level: 9 })));
}

export const iend = (): Uint8Array => chunk('IEND', new Uint8Array(0));

/** PNG made from IHDR + `before` chunks + IDAT + `after` chunks + IEND. */
export function buildPng(opts: { width?: number; height?: number; before?: Uint8Array[]; after?: Uint8Array[]; tail?: Uint8Array } = {}): Uint8Array {
  const w = opts.width ?? 64;
  const h = opts.height ?? 48;
  return cat(PNG_SIG, ihdr(w, h), ...(opts.before ?? []), idatFor(w, h), ...(opts.after ?? []), iend(), opts.tail ?? new Uint8Array(0));
}

export const textChunk = (keyword: string, text: string): Uint8Array => chunk('tEXt', cat(latin(keyword), Uint8Array.of(0), latin(text)));
export const ztxtChunk = (keyword: string, text: Uint8Array | string): Uint8Array =>
  chunk('zTXt', cat(latin(keyword), Uint8Array.of(0, 0), Uint8Array.from(deflateSync(typeof text === 'string' ? latin(text) : text, { level: 9 }))));
export function itxtChunk(keyword: string, text: string, opts: { compressed?: boolean; lang?: string; translated?: string } = {}): Uint8Array {
  const body = enc(text);
  const payload = opts.compressed ? Uint8Array.from(deflateSync(body)) : body;
  return chunk('iTXt', cat(latin(keyword), Uint8Array.of(0, opts.compressed ? 1 : 0, 0), enc(opts.lang ?? ''), Uint8Array.of(0), enc(opts.translated ?? ''), Uint8Array.of(0), payload));
}
export const timeChunk = (y: number, mo: number, d: number, h: number, mi: number, s: number): Uint8Array =>
  chunk('tIME', Uint8Array.of(y >> 8, y & 255, mo, d, h, mi, s));
export const physChunk = (ppu: number): Uint8Array => chunk('pHYs', cat(u32be(ppu), u32be(ppu), Uint8Array.of(1)));
export const iccpChunk = (name: string, profile: Uint8Array): Uint8Array =>
  chunk('iCCP', cat(latin(name), Uint8Array.of(0, 0), Uint8Array.from(deflateSync(profile))));

/** The picture's compressed data split over two IDAT chunks, so tests can put something between them. */
export function idatSplit(width: number, height: number): [Uint8Array, Uint8Array] {
  const whole = idatFor(width, height);
  const data = whole.subarray(8, whole.length - 4);
  const half = Math.floor(data.length / 2);
  return [chunk('IDAT', data.subarray(0, half)), chunk('IDAT', data.subarray(half))];
}
