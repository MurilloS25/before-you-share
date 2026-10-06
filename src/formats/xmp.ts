import type { FindingSink } from '../core/findings';
import type { EvidenceLocation } from '../core/types';

/**
 * XMP is XML. It is never parsed with a DOM parser or inserted as markup: values are extracted
 * with bounded, non-backtracking string searches and always treated as plain text.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)
        ? String.fromCodePoint(cp)
        : '�';
    }
    return ENTITIES[e] ?? m;
  });
}

/** Values of `<prefix:name>` as list items or plain text, plus `prefix:name="value"` attributes. */
export function xmpValues(xml: string, qname: string): string[] {
  const out: string[] = [];
  const esc = qname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attr = new RegExp(`(?:^|[\\s<])${esc}\\s*=\\s*"([^"]{0,2000})"`, 'g');
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = attr.exec(xml)) && guard++ < 50) out.push(decodeEntities(m[1]!));
  const el = new RegExp(`<${esc}(?:\\s[^>]{0,500})?>([\\s\\S]{0,20000}?)</${esc}>`, 'g');
  guard = 0;
  while ((m = el.exec(xml)) && guard++ < 50) {
    const inner = m[1]!;
    const items: string[] = [];
    const li = /<rdf:li(?:\s[^>]{0,300})?>([\s\S]{0,4000}?)<\/rdf:li>/g;
    let n: RegExpExecArray | null;
    let g2 = 0;
    while ((n = li.exec(inner)) && g2++ < 100) items.push(decodeEntities(n[1]!.replace(/<[^>]*>/g, '').trim()));
    if (items.length > 0) out.push(...items);
    else {
      const plain = decodeEntities(inner.replace(/<[^>]*>/g, '').trim());
      if (plain) out.push(plain);
    }
  }
  return out.filter((s) => s !== '');
}

interface Spec {
  names: string[];
  code: string;
  label?: string;
  join?: boolean;
}

const SPECS: Spec[] = [
  { names: ['dc:creator'], code: 'xmp.creator', join: true },
  { names: ['dc:rights'], code: 'xmp.rights', join: true },
  { names: ['xmp:CreatorTool'], code: 'xmp.tool' },
  { names: ['stEvt:softwareAgent'], code: 'xmp.agent' },
  { names: ['xmp:CreateDate'], code: 'xmp.date', label: 'XMP creation date' },
  { names: ['xmp:ModifyDate'], code: 'xmp.date', label: 'XMP modification date' },
  { names: ['xmp:MetadataDate'], code: 'xmp.date', label: 'XMP metadata date' },
  { names: ['photoshop:DateCreated'], code: 'xmp.date', label: 'Photoshop creation date' },
  { names: ['dc:title'], code: 'xmp.title', join: true },
  { names: ['dc:description'], code: 'xmp.description', join: true },
  { names: ['dc:subject'], code: 'xmp.keywords', join: true },
  { names: ['xmpMM:DocumentID'], code: 'xmp.document-id', label: 'XMP document ID' },
  { names: ['xmpMM:InstanceID'], code: 'xmp.document-id', label: 'XMP instance ID' },
  { names: ['xmpMM:OriginalDocumentID'], code: 'xmp.document-id', label: 'XMP original document ID' },
  { names: ['tiff:Make'], code: 'xmp.device', label: 'Camera maker (XMP)' },
  { names: ['tiff:Model'], code: 'xmp.device', label: 'Camera model (XMP)' },
  { names: ['photoshop:City'], code: 'xmp.location', label: 'City (XMP)' },
  { names: ['photoshop:State'], code: 'xmp.location', label: 'Region (XMP)' },
  { names: ['photoshop:Country'], code: 'xmp.location', label: 'Country (XMP)' },
  { names: ['exif:GPSLatitude'], code: 'xmp.location', label: 'GPS latitude (XMP)' },
  { names: ['exif:GPSLongitude'], code: 'xmp.location', label: 'GPS longitude (XMP)' },
];

export interface XmpResult {
  itemised: number;
  hasExtendedPointer: boolean;
}

/** Decode and itemise well-known XMP properties from a packet. */
export function analyseXmp(
  packet: Uint8Array,
  sink: FindingSink,
  where: string,
  location: EvidenceLocation,
  prefix: 'xmp' | 'pdf.xmp' = 'xmp',
): XmpResult {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(packet);
  const toCode = (c: string): string => (prefix === 'pdf.xmp' && c === 'xmp.packet' ? 'pdf.xmp' : c);
  let itemised = 0;
  const seen = new Set<string>();
  for (const spec of SPECS) {
    for (const name of spec.names) {
      const values = xmpValues(text, name);
      if (values.length === 0) continue;
      const key = `${name}:${values.join('|')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const f = sink.add(spec.code, {
        label: spec.label,
        value: spec.join ? values.join('; ') : values[0]!,
        source: `${where}, property ${name}`,
        location,
        group: prefix === 'pdf.xmp' ? null : undefined,
        transformation: prefix === 'pdf.xmp' ? 'unsupported' : undefined,
      });
      if (f) itemised++;
    }
  }
  sink.add(toCode('xmp.packet'), {
    value: `${packet.length} bytes, ${itemised} well-known propert${itemised === 1 ? 'y' : 'ies'} itemised`,
    source: where,
    location,
    group: prefix === 'pdf.xmp' ? null : undefined,
    transformation: prefix === 'pdf.xmp' ? 'unsupported' : undefined,
  });
  return { itemised, hasExtendedPointer: /xmpNote:HasExtendedXMP/.test(text) };
}
