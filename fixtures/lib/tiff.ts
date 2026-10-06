/** Minimal TIFF/EXIF writer used only to build synthetic fixtures. */

export interface TiffEntry {
  tag: number;
  type: number;
  count: number;
  /** Raw value bytes, already encoded in the target byte order. */
  data?: Uint8Array;
  /** Value is the offset of another IFD in this file. */
  ptr?: string;
  /** Value is the offset of a blob placed after the IFDs. */
  blob?: Uint8Array;
}
export interface TiffIfd {
  name: string;
  entries: TiffEntry[];
  next?: string;
}

const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

export class TiffBuilder {
  constructor(private readonly le = false) {}

  u16(v: number): Uint8Array {
    return this.le ? Uint8Array.of(v & 255, (v >> 8) & 255) : Uint8Array.of((v >> 8) & 255, v & 255);
  }
  u32(v: number): Uint8Array {
    const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    return Uint8Array.from(this.le ? b.reverse() : b);
  }
  ascii(tag: number, s: string): TiffEntry {
    const body = new TextEncoder().encode(s);
    const d = new Uint8Array(body.length + 1);
    d.set(body);
    return { tag, type: 2, count: d.length, data: d };
  }
  short(tag: number, v: number): TiffEntry {
    return { tag, type: 3, count: 1, data: this.u16(v) };
  }
  long(tag: number, v: number): TiffEntry {
    return { tag, type: 4, count: 1, data: this.u32(v) };
  }
  rationals(tag: number, pairs: Array<[number, number]>): TiffEntry {
    const parts = pairs.flatMap(([n, d]) => [this.u32(n), this.u32(d)]);
    return { tag, type: 5, count: pairs.length, data: cat(parts) };
  }
  bytes(tag: number, type: number, data: Uint8Array): TiffEntry {
    return { tag, type, count: data.length / (SIZE[type] ?? 1), data };
  }
  ptr(tag: number, name: string): TiffEntry {
    return { tag, type: 4, count: 1, ptr: name };
  }
  blobLong(tag: number, blob: Uint8Array): TiffEntry {
    return { tag, type: 4, count: 1, blob };
  }

  /** First IFD in `ifds` is IFD0. */
  build(ifds: TiffIfd[]): Uint8Array {
    const offsets = new Map<string, number>();
    let pos = 8;
    for (const ifd of ifds) {
      offsets.set(ifd.name, pos);
      pos += 2 + ifd.entries.length * 12 + 4;
    }
    const placed = new Map<TiffEntry, number>();
    for (const ifd of ifds) {
      for (const e of ifd.entries) {
        const len = e.blob ? e.blob.length : (e.data?.length ?? 0);
        if (e.blob || (!e.ptr && len > 4)) {
          placed.set(e, pos);
          pos += len + (len % 2);
        }
      }
    }
    const out = new Uint8Array(pos);
    out[0] = out[1] = this.le ? 0x49 : 0x4d;
    out.set(this.u16(42), 2);
    out.set(this.u32(8), 4);
    for (const ifd of ifds) {
      let o = offsets.get(ifd.name)!;
      out.set(this.u16(ifd.entries.length), o);
      o += 2;
      for (const e of ifd.entries) {
        out.set(this.u16(e.tag), o);
        out.set(this.u16(e.type), o + 2);
        out.set(this.u32(e.count), o + 4);
        if (e.ptr) out.set(this.u32(offsets.get(e.ptr)!), o + 8);
        else if (e.blob) {
          out.set(this.u32(placed.get(e)!), o + 8);
          out.set(e.blob, placed.get(e)!);
        } else if (e.data!.length > 4) {
          out.set(this.u32(placed.get(e)!), o + 8);
          out.set(e.data!, placed.get(e)!);
        } else out.set(e.data!, o + 8);
        o += 12;
      }
      out.set(this.u32(ifd.next ? offsets.get(ifd.next)! : 0), o);
    }
    return out;
  }
}

function cat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
