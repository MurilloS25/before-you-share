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

/**
 * Values of `<prefix:name>` as list items or plain text, plus `prefix:name="value"` attributes.
 * Index-based scanning with attempt caps: cost is linear in the packet size per property, so a hostile
 * packet of repeated openings cannot cause quadratic work.
 */
export function xmpValues(xml: string, qname: string): string[] {
  const out: string[] = [];
  let from = 0;
  let attempts = 0;
  while (attempts++ < 200 && out.length < 50) {
    const i = xml.indexOf(qname, from);
    if (i === -1) break;
    from = i + qname.length;
    const prev = i > 0 ? xml[i - 1]! : ' ';
    if (prev === '<') {
      const next = xml[from];
      if (next === undefined || !(next === '>' || next === '/' || /\s/.test(next))) continue;
      const gt = xml.indexOf('>', from);
      if (gt === -1 || gt - from > 500) continue;
      if (xml[gt - 1] === '/') continue;
      const close = xml.indexOf(`</${qname}>`, gt + 1);
      if (close === -1) break; // no closing tag anywhere later either
      if (close - gt > 20000) continue;
      const inner = xml.slice(gt + 1, close);
      from = close;
      const items: string[] = [];
      let p = 0;
      let guard = 0;
      while (guard++ < 100) {
        const li = inner.indexOf('<rdf:li', p);
        if (li === -1) break;
        const liGt = inner.indexOf('>', li);
        if (liGt === -1) break;
        const liEnd = inner.indexOf('</rdf:li>', liGt);
        if (liEnd === -1) break;
        items.push(decodeEntities(inner.slice(liGt + 1, Math.min(liEnd, liGt + 4001)).replace(/<[^>]*>/g, '').trim()));
        p = liEnd + 9;
      }
      if (items.length > 0) out.push(...items);
      else {
        const plain = decodeEntities(inner.slice(0, 4000).replace(/<[^>]*>/g, '').trim());
        if (plain) out.push(plain);
      }
    } else if (/\s/.test(prev)) {
      let j = from;
      while (j < from + 8 && /\s/.test(xml[j] ?? '')) j++;
      if (xml[j] !== '=') continue;
      j++;
      while (j < from + 16 && /\s/.test(xml[j] ?? '')) j++;
      if (xml[j] !== '"') continue;
      const end = xml.indexOf('"', j + 1);
      if (end === -1 || end - j > 2001) continue;
      out.push(decodeEntities(xml.slice(j + 1, end)));
      from = end;
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
