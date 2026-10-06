import jpegjs from 'jpeg-js';
import { TiffBuilder, type TiffIfd } from './tiff';

export const enc = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'utf8'));
export const latin = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'latin1'));
export function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Deterministic, asymmetric synthetic picture: a bright block top-left on a gradient. */
export function syntheticRgba(width: number, height: number): Uint8Array {
  const d = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const block = x < 12 && y < 12;
      d[i] = block ? 255 : Math.round((x / width) * 200);
      d[i + 1] = block ? 255 : Math.round((y / height) * 200);
      d[i + 2] = block ? 255 : 90 + ((x + y) % 40);
      d[i + 3] = 255;
    }
  }
  return d;
}

export function baseJpeg(width = 64, height = 48, quality = 90): Uint8Array {
  const raw = jpegjs.encode({ data: syntheticRgba(width, height), width, height }, quality);
  return Uint8Array.from(raw.data);
}

export function segment(marker: number, payload: Uint8Array): Uint8Array {
  const len = payload.length + 2;
  if (len > 0xffff) throw new Error('segment too large');
  return cat(Uint8Array.of(0xff, marker, len >> 8, len & 255), payload);
}

/** Insert segments after the JFIF APP0 segment (or after SOI if absent). */
export function insertSegments(jpeg: Uint8Array, segs: Uint8Array[]): Uint8Array {
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 2 + 2 + ((jpeg[4]! << 8) | jpeg[5]!);
  return cat(jpeg.subarray(0, at), ...segs, jpeg.subarray(at));
}

const EXIF_ID = latin('Exif\0\0');
const XMP_ID = latin('http://ns.adobe.com/xap/1.0/\0');

export function exifSegment(tiff: Uint8Array): Uint8Array {
  return segment(0xe1, cat(EXIF_ID, tiff));
}
export function xmpSegment(xml: string): Uint8Array {
  return segment(0xe1, cat(XMP_ID, enc(xml)));
}
export function commentSegment(text: string): Uint8Array {
  return segment(0xfe, enc(text));
}

export function xmpPacket(inner: string): string {
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${inner}</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
}

export const SYNTH_XMP = xmpPacket(
  `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmp:CreatorTool="Fixture Editor 1.0" xmp:CreateDate="2000-01-01T00:00:00Z" photoshop:City="Fixture City" xmpMM:DocumentID="xmp.did:00000000-0000-4000-8000-000000000001"><dc:creator><rdf:Seq><rdf:li>Example Person</rdf:li></rdf:Seq></dc:creator><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Fixture title &amp; more</rdf:li></rdf:Alt></dc:title></rdf:Description>`,
);

/** A tiny synthetic ICC profile: valid 128-byte header, one 'desc' tag. */
export function syntheticIcc(description = 'Example Synthetic Profile'): Uint8Array {
  const desc = latin(description + '\0');
  const descTag = cat(latin('desc'), Uint8Array.of(0, 0, 0, 0), u32be(desc.length), desc, new Uint8Array(8));
  const tableEnd = 128 + 4 + 12;
  const total = tableEnd + descTag.length;
  const h = new Uint8Array(128);
  h.set(u32be(total), 0);
  h.set(u32be(0x02100000), 8);
  h.set(latin('mntr'), 12);
  h.set(latin('RGB '), 16);
  h.set(latin('XYZ '), 20);
  h.set(Uint8Array.of(0x07, 0xd0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0), 24); // 2000-01-01 00:00:00
  h.set(latin('acsp'), 36);
  return cat(h, u32be(1), latin('desc'), u32be(tableEnd), u32be(descTag.length), descTag);
}
export function u32be(v: number): Uint8Array {
  return Uint8Array.of((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
}

export function iccSegments(profile: Uint8Array): Uint8Array[] {
  return [segment(0xe2, cat(latin('ICC_PROFILE\0'), Uint8Array.of(1, 1), profile))];
}

/** Photoshop 8BIM block with one IPTC resource built from record-2 datasets. */
export function photoshopSegment(datasets: Array<[number, string]>, withThumb = false): Uint8Array {
  const iptc = cat(
    ...datasets.map(([ds, s]) => {
      const body = enc(s);
      return cat(Uint8Array.of(0x1c, 2, ds, (body.length >> 8) & 255, body.length & 255), body);
    }),
  );
  const pad = iptc.length % 2 ? Uint8Array.of(0) : new Uint8Array(0);
  const res = cat(latin('8BIM'), Uint8Array.of(0x04, 0x04, 0, 0), u32be(iptc.length), iptc, pad);
  const thumbData = new Uint8Array(32);
  const thumb = withThumb ? cat(latin('8BIM'), Uint8Array.of(0x04, 0x0c, 0, 0), u32be(thumbData.length), thumbData) : new Uint8Array(0);
  return segment(0xed, cat(latin('Photoshop 3.0\0'), res, thumb));
}

export interface ExifOptions {
  le?: boolean;
  orientation?: number;
  make?: string;
  model?: string;
  software?: string;
  datetime?: string;
  artist?: string;
  copyright?: string;
  description?: string;
  original?: string;
  lens?: string;
  serial?: string;
  owner?: string;
  userComment?: string;
  makerNote?: boolean;
  xpAuthor?: string;
  gps?: { lat: number; lon: number; latRef?: string; lonRef?: string; alt?: number; date?: string };
  thumbnail?: Uint8Array;
}

function dms(v: number): Array<[number, number]> {
  const d = Math.floor(v);
  const m = Math.floor((v - d) * 60);
  const s = Math.round(((v - d) * 60 - m) * 60 * 1000);
  return [
    [d, 1],
    [m, 1],
    [s, 1000],
  ];
}

export function buildExif(o: ExifOptions): Uint8Array {
  const t = new TiffBuilder(o.le ?? false);
  const ifd0: TiffIfd = { name: 'ifd0', entries: [] };
  const exif: TiffIfd = { name: 'exif', entries: [] };
  const gps: TiffIfd = { name: 'gps', entries: [] };
  const ifds: TiffIfd[] = [ifd0];
  if (o.description) ifd0.entries.push(t.ascii(0x010e, o.description));
  if (o.make) ifd0.entries.push(t.ascii(0x010f, o.make));
  if (o.model) ifd0.entries.push(t.ascii(0x0110, o.model));
  if (o.orientation) ifd0.entries.push(t.short(0x0112, o.orientation));
  if (o.software) ifd0.entries.push(t.ascii(0x0131, o.software));
  if (o.datetime) ifd0.entries.push(t.ascii(0x0132, o.datetime));
  if (o.artist) ifd0.entries.push(t.ascii(0x013b, o.artist));
  if (o.copyright) ifd0.entries.push(t.ascii(0x8298, o.copyright));
  if (o.xpAuthor) {
    const u = new Uint8Array((o.xpAuthor.length + 1) * 2);
    for (let i = 0; i < o.xpAuthor.length; i++) {
      u[i * 2] = o.xpAuthor.charCodeAt(i) & 255;
      u[i * 2 + 1] = o.xpAuthor.charCodeAt(i) >> 8;
    }
    ifd0.entries.push(t.bytes(0x9c9d, 1, u));
  }
  if (o.original || o.lens || o.serial || o.owner || o.userComment || o.makerNote) {
    ifd0.entries.push(t.ptr(0x8769, 'exif'));
    ifds.push(exif);
    if (o.original) exif.entries.push(t.ascii(0x9003, o.original), t.ascii(0x9004, o.original));
    if (o.userComment) exif.entries.push(t.bytes(0x9286, 7, cat(latin('ASCII\0\0\0'), latin(o.userComment))));
    if (o.makerNote) exif.entries.push(t.bytes(0x927c, 7, Uint8Array.from({ length: 24 }, (_, i) => i)));
    if (o.owner) exif.entries.push(t.ascii(0xa430, o.owner));
    if (o.serial) exif.entries.push(t.ascii(0xa431, o.serial));
    if (o.lens) exif.entries.push(t.ascii(0xa434, o.lens));
  }
  if (o.gps) {
    ifd0.entries.push(t.ptr(0x8825, 'gps'));
    ifds.push(gps);
    const g = o.gps;
    gps.entries.push(
      t.ascii(1, g.latRef ?? 'N'),
      t.rationals(2, dms(g.lat)),
      t.ascii(3, g.lonRef ?? 'E'),
      t.rationals(4, dms(g.lon)),
    );
    if (g.alt !== undefined) gps.entries.push({ tag: 5, type: 1, count: 1, data: Uint8Array.of(0) }, t.rationals(6, [[Math.round(g.alt * 10), 10]]));
    if (g.date) gps.entries.push(t.ascii(0x1d, g.date));
  }
  if (o.thumbnail) {
    ifd0.next = 'ifd1';
    ifds.push({ name: 'ifd1', entries: [t.blobLong(0x0201, o.thumbnail), t.long(0x0202, o.thumbnail.length)] });
  }
  // Entries must be sorted by tag within an IFD.
  for (const i of ifds) i.entries.sort((a, b) => a.tag - b.tag);
  return t.build(ifds);
}
