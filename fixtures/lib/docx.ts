import { crc32, deflateRawSync } from 'node:zlib';
import { cat, enc, latin } from './jpeg';

/** Deterministic ZIP writer for synthetic fixtures (fixed timestamps, no extra fields). */
export interface ZipItem {
  name: string;
  data?: Uint8Array;
  /** 0 = stored, 8 = deflate. */
  method?: 0 | 8;
  flags?: number;
  /** Lie in the central directory (for hostile fixtures). */
  declaredUncompressed?: number;
  declaredCompressed?: number;
  /** Provide already-compressed data instead of compressing `data`. */
  raw?: { compressed: Uint8Array; uncompressedSize: number; crc: number };
}

const u16 = (v: number): Uint8Array => Uint8Array.of(v & 255, (v >> 8) & 255);
const u32 = (v: number): Uint8Array => Uint8Array.of(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
const DOS_TIME = 0;
const DOS_DATE = ((2000 - 1980) << 9) | (1 << 5) | 1;

export function zip(items: ZipItem[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const it of items) {
    const name = enc(it.name);
    const method = it.method ?? 8;
    const plain = it.data ?? new Uint8Array(0);
    const compressed = it.raw ? it.raw.compressed : method === 8 ? Uint8Array.from(deflateRawSync(plain, { level: 9 })) : plain;
    const usize = it.raw ? it.raw.uncompressedSize : plain.length;
    const crc = it.raw ? it.raw.crc : crc32(plain) >>> 0;
    const flags = it.flags ?? 0;
    const local = cat(u32(0x04034b50), u16(20), u16(flags), u16(method), u16(DOS_TIME), u16(DOS_DATE), u32(crc), u32(compressed.length), u32(usize), u16(name.length), u16(0), name, compressed);
    locals.push(local);
    central.push(
      cat(
        u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u16(DOS_TIME), u16(DOS_DATE), u32(crc),
        u32(it.declaredCompressed ?? compressed.length), u32(it.declaredUncompressed ?? usize),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
      ),
    );
    offset += local.length;
  }
  const cd = cat(...central);
  const eocd = cat(u32(0x06054b50), u16(0), u16(0), u16(items.length), u16(items.length), u32(cd.length), u32(offset), u16(0));
  return cat(...locals, cd, eocd);
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface DocxOptions {
  creator?: string;
  lastModifiedBy?: string;
  created?: string;
  modified?: string;
  title?: string;
  subject?: string;
  keywords?: string;
  description?: string;
  revision?: number;
  app?: { application?: string; version?: string; company?: string; manager?: string; template?: string; totalTime?: number };
  custom?: Array<[string, string]>;
  comments?: Array<{ author: string; date: string; text: string }>;
  tracked?: Array<{ kind: 'ins' | 'del'; author: string; date: string; text: string }>;
  hiddenRuns?: number;
  rsids?: string[];
  relationships?: Array<{ type: string; target: string; external?: boolean }>;
  media?: Array<{ name: string; data: Uint8Array }>;
  embeddings?: Array<{ name: string; data: Uint8Array }>;
  thumbnail?: Uint8Array;
  customXml?: boolean;
  macro?: boolean;
  signature?: boolean;
  extra?: ZipItem[];
}

export function buildDocx(o: DocxOptions = {}): ZipItem[] {
  const items: ZipItem[] = [];
  items.push({
    name: '[Content_Types].xml',
    data: enc(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document${o.macro ? '.macroEnabled' : ''}.main+xml"/></Types>`),
  });
  const core: string[] = [];
  if (o.title) core.push(`<dc:title>${esc(o.title)}</dc:title>`);
  if (o.subject) core.push(`<dc:subject>${esc(o.subject)}</dc:subject>`);
  if (o.creator) core.push(`<dc:creator>${esc(o.creator)}</dc:creator>`);
  if (o.keywords) core.push(`<cp:keywords>${esc(o.keywords)}</cp:keywords>`);
  if (o.description) core.push(`<dc:description>${esc(o.description)}</dc:description>`);
  if (o.lastModifiedBy) core.push(`<cp:lastModifiedBy>${esc(o.lastModifiedBy)}</cp:lastModifiedBy>`);
  if (o.revision !== undefined) core.push(`<cp:revision>${o.revision}</cp:revision>`);
  if (o.created) core.push(`<dcterms:created xsi:type="dcterms:W3CDTF">${o.created}</dcterms:created>`);
  if (o.modified) core.push(`<dcterms:modified xsi:type="dcterms:W3CDTF">${o.modified}</dcterms:modified>`);
  if (core.length > 0) {
    items.push({
      name: 'docProps/core.xml',
      data: enc(`${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${core.join('')}</cp:coreProperties>`),
    });
  }
  if (o.app) {
    const a = o.app;
    const parts = [
      a.template && `<Template>${esc(a.template)}</Template>`,
      a.totalTime !== undefined && `<TotalTime>${a.totalTime}</TotalTime>`,
      a.application && `<Application>${esc(a.application)}</Application>`,
      a.manager && `<Manager>${esc(a.manager)}</Manager>`,
      a.company && `<Company>${esc(a.company)}</Company>`,
      a.version && `<AppVersion>${esc(a.version)}</AppVersion>`,
    ].filter(Boolean);
    items.push({ name: 'docProps/app.xml', data: enc(`${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">${parts.join('')}</Properties>`) });
  }
  if (o.custom) {
    items.push({
      name: 'docProps/custom.xml',
      data: enc(`${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${o.custom
        .map(([k, v], i) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="${esc(k)}"><vt:lpwstr>${esc(v)}</vt:lpwstr></property>`)
        .join('')}</Properties>`),
    });
  }
  const body: string[] = ['<w:p><w:r><w:t>Synthetic fixture paragraph.</w:t></w:r></w:p>'];
  for (const t of o.tracked ?? []) {
    body.push(`<w:p><w:${t.kind} w:id="1" w:author="${esc(t.author)}" w:date="${t.date}"><w:r><w:t>${esc(t.text)}</w:t></w:r></w:${t.kind}></w:p>`);
  }
  for (let i = 0; i < (o.hiddenRuns ?? 0); i++) body.push('<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden fixture text</w:t></w:r></w:p>');
  (o.rsids ?? []).forEach((r) => body.push(`<w:p w:rsidR="${r}"><w:r><w:t>x</w:t></w:r></w:p>`));
  items.push({
    name: 'word/document.xml',
    data: enc(`${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}</w:body></w:document>`),
  });
  if (o.comments) {
    items.push({
      name: 'word/comments.xml',
      data: enc(`${XML}<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${o.comments
        .map((c, i) => `<w:comment w:id="${i}" w:author="${esc(c.author)}" w:date="${c.date}"><w:p><w:r><w:t>${esc(c.text)}</w:t></w:r></w:p></w:comment>`)
        .join('')}</w:comments>`),
    });
  }
  if (o.relationships) {
    items.push({
      name: 'word/_rels/document.xml.rels',
      data: enc(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${o.relationships
        .map((r, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`)
        .join('')}</Relationships>`),
    });
  }
  for (const m of o.media ?? []) items.push({ name: `word/media/${m.name}`, data: m.data, method: 0 });
  for (const m of o.embeddings ?? []) items.push({ name: `word/embeddings/${m.name}`, data: m.data });
  if (o.thumbnail) items.push({ name: 'docProps/thumbnail.jpeg', data: o.thumbnail, method: 0 });
  if (o.customXml) items.push({ name: 'customXml/item1.xml', data: enc(`${XML}<root>fixture</root>`) });
  if (o.macro) items.push({ name: 'word/vbaProject.bin', data: latin('FIXTURE-NOT-A-REAL-MACRO-PROJECT') });
  if (o.signature) items.push({ name: '_xmlsignatures/sig1.xml', data: enc(`${XML}<Signature/>`) });
  items.push(...(o.extra ?? []));
  return items;
}
