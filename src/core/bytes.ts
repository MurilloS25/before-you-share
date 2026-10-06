import { ParseLimitError } from './errors';

/** Bounds-checked big/little-endian view over a Uint8Array. Never reads outside [0, length). */
export class Reader {
  readonly bytes: Uint8Array;
  readonly length: number;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.length = bytes.length;
  }
  has(offset: number, size: number): boolean {
    return (
      Number.isSafeInteger(offset) &&
      Number.isSafeInteger(size) &&
      offset >= 0 &&
      size >= 0 &&
      offset + size <= this.length
    );
  }
  private need(offset: number, size: number): void {
    if (!this.has(offset, size)) throw new ParseLimitError('A read fell outside the available bytes.');
  }
  u8(o: number): number {
    this.need(o, 1);
    return this.bytes[o]!;
  }
  u16(o: number, le = false): number {
    this.need(o, 2);
    const a = this.bytes[o]!;
    const b = this.bytes[o + 1]!;
    return le ? a | (b << 8) : (a << 8) | b;
  }
  u32(o: number, le = false): number {
    this.need(o, 4);
    const b = this.bytes;
    const a = b[o]!;
    const c = b[o + 1]!;
    const d = b[o + 2]!;
    const e = b[o + 3]!;
    return le ? (a | (c << 8) | (d << 16) | (e << 24)) >>> 0 : ((a << 24) | (c << 16) | (d << 8) | e) >>> 0;
  }
  i16(o: number, le = false): number {
    const v = this.u16(o, le);
    return v & 0x8000 ? v - 0x10000 : v;
  }
  i32(o: number, le = false): number {
    return this.u32(o, le) | 0;
  }
  slice(o: number, size: number): Uint8Array {
    this.need(o, size);
    return this.bytes.subarray(o, o + size);
  }
  /** Exact ASCII match at offset (false, not an error, when out of range). */
  startsWithAscii(o: number, text: string): boolean {
    if (!this.has(o, text.length)) return false;
    for (let i = 0; i < text.length; i++) if (this.bytes[o + i] !== text.charCodeAt(i)) return false;
    return true;
  }
}

export function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

export function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

/** Lenient UTF-8 decode; invalid sequences become U+FFFD rather than throwing. */
export function utf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function utf16le(bytes: Uint8Array): string {
  return new TextDecoder('utf-16le', { fatal: false }).decode(bytes);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from = 0, to = hay.length): number {
  if (needle.length === 0) return -1;
  const end = Math.min(to, hay.length) - needle.length;
  const first = needle[0]!;
  let i = hay.indexOf(first, from);
  while (i !== -1 && i <= end) {
    let k = 1;
    while (k < needle.length && hay[i + k] === needle[k]) k++;
    if (k === needle.length) return i;
    i = hay.indexOf(first, i + 1);
  }
  return -1;
}

/**
 * Text for display: replaces control characters and bidi controls (so a hostile value cannot
 * reorder surrounding UI text) and truncates. Always render the result as text, never as HTML.
 */
export function displayText(value: string, max = 400): string {
  const cleaned = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '�')
    .replace(/[‪-‮⁦-⁩‎‏؜]/g, '�');
  return cleaned.length > max
    ? `${cleaned.slice(0, max)}… (${cleaned.length - max} more characters not shown)`
    : cleaned;
}
