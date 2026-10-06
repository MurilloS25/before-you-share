import { displayText, utf8 } from '../core/bytes';
import { FindingSink } from '../core/findings';
import { LIMITS } from '../core/limits';
import type { CoverageItem, DocxSummary } from '../core/types';
import type { FormatAnalysis } from './common';
import { xmpValues } from './xmp';
import { readZipDirectory, readZipEntry, type ZipDirectory, type ZipEntry } from './zip';

export interface DocxAnalysis extends FormatAnalysis {
  docx: DocxSummary;
}

/** True when the ZIP looks like a Word package: it has the content-types part and the main document part. */
export function looksLikeDocx(dir: ZipDirectory): boolean {
  const names = new Set(dir.entries.map((e) => e.name));
  return names.has('[Content_Types].xml') && names.has('word/document.xml');
}

function count(xml: string, needle: string, cap = 100_000): number {
  let n = 0;
  let i = xml.indexOf(needle);
  while (i !== -1 && n < cap) {
    n++;
    i = xml.indexOf(needle, i + needle.length);
  }
  return n;
}

function distinctAttr(xml: string, attr: string, cap: number): string[] {
  const out = new Set<string>();
  const needle = `${attr}="`;
  let i = xml.indexOf(needle);
  let guard = 0;
  while (i !== -1 && out.size < cap && guard++ < 200_000) {
    const start = i + needle.length;
    const end = xml.indexOf('"', start);
    if (end === -1 || end - start > 300) break;
    out.add(xml.slice(start, end));
    i = xml.indexOf(needle, end);
  }
  return [...out];
}

function relationships(xml: string): Array<{ type: string; target: string; external: boolean }> {
  const out: Array<{ type: string; target: string; external: boolean }> = [];
  let i = xml.indexOf('<Relationship ');
  let guard = 0;
  while (i !== -1 && guard++ < 2000) {
    const end = xml.indexOf('>', i);
    if (end === -1) break;
    const tag = xml.slice(i, end);
    const attr = (name: string): string => {
      const k = tag.indexOf(`${name}="`);
      if (k === -1) return '';
      const s = k + name.length + 2;
      const e = tag.indexOf('"', s);
      return e === -1 ? '' : tag.slice(s, e);
    };
    out.push({ type: attr('Type').split('/').pop() ?? '', target: attr('Target'), external: attr('TargetMode') === 'External' });
    i = xml.indexOf('<Relationship ', end);
  }
  return out;
}

export async function analyseDocx(bytes: Uint8Array, dirIn?: ZipDirectory): Promise<DocxAnalysis> {
  const sink = new FindingSink();
  const dir = dirIn ?? readZipDirectory(bytes);
  const summary: DocxSummary = { entries: dir.entries.length, declaredUncompressed: dir.declaredUncompressed, partsRead: 0, macroEnabled: false, encrypted: false };
  const byName = new Map<string, ZipEntry>();
  for (const e of dir.entries) if (!byName.has(e.name)) byName.set(e.name, e);

  // ---- package health (never extracts to disk; names are text)
  const where = 'DOCX package (ZIP central directory)';
  let suspicious = false;
  const dupes = dir.entries.length - byName.size;
  const odd = dir.entries.filter((e) => /(^|[\\/])\.\.([\\/]|$)/.test(e.name) || e.name.startsWith('/') || /^[a-zA-Z]:/.test(e.name) || e.name.includes('\\')).map((e) => e.name);
  const worstRatio = dir.entries.reduce((m, e) => Math.max(m, e.compressedSize > 0 ? e.uncompressedSize / e.compressedSize : e.uncompressedSize > 0 ? Infinity : 0), 0);
  const encryptedEntries = dir.entries.filter((e) => e.flags & 1).length;
  summary.encrypted = encryptedEntries > 0;
  sink.add('docx.zip-entries', {
    value: `${dir.entries.length} entr${dir.entries.length === 1 ? 'y' : 'ies'}, ${dir.declaredUncompressed.toLocaleString('en-US')} bytes declared when unpacked`,
    source: where,
    location: { kind: 'structure', path: 'ZIP central directory' },
  });
  if (dupes > 0) {
    suspicious = true;
    sink.add('docx.zip-suspicious', { value: `${dupes} duplicated entry name${dupes === 1 ? '' : 's'}; only the first of each is read`, source: where, status: 'suspicious' });
  }
  if (odd.length > 0) {
    suspicious = true;
    sink.add('docx.zip-suspicious', { value: `Entry names that climb out of the package or use absolute or backslash paths: ${odd.slice(0, 5).map((n) => displayText(n, 80)).join(', ')}. Nothing is extracted.`, source: where, status: 'suspicious' });
  }
  if (dir.declaredUncompressed > LIMITS.maxZipDeclaredTotal || worstRatio > LIMITS.maxZipRatio) {
    suspicious = true;
    sink.add('docx.zip-suspicious', {
      value: `The package declares ${dir.declaredUncompressed.toLocaleString('en-US')} bytes when unpacked${Number.isFinite(worstRatio) ? ` and an expansion ratio up to ${Math.round(worstRatio).toLocaleString('en-US')}:1` : ''}. This can indicate a compression bomb. Nothing is expanded beyond ${LIMITS.maxZipPartBytes / 1024} KiB per part.`,
      source: where,
      status: 'suspicious',
    });
  }
  if (encryptedEntries > 0) {
    sink.add('docx.encrypted', { value: `${encryptedEntries} entr${encryptedEntries === 1 ? 'y is' : 'ies are'} encrypted`, source: where, status: 'verified' });
  }
  if (dir.zip64) sink.add('docx.limit', { value: 'ZIP64 values were found; ZIP64 is not supported', source: where, status: 'unsupported' });
  if (dir.limitHit) sink.add('docx.limit', { value: `More than ${LIMITS.maxZipEntries} entries; the rest were not listed`, source: where, status: 'unsupported' });
  if (dir.invalid) sink.add('docx.malformed', { value: dir.invalid, source: where, status: 'suspicious' });

  // ---- parts we read (bounded, text only)
  let budget: number = LIMITS.maxZipTotalInflate;
  let partial = false;
  const read = async (name: string, cap: number = LIMITS.maxZipPartBytes): Promise<string | null> => {
    const e = byName.get(name);
    if (!e || budget <= 0) return null;
    const part = await readZipEntry(bytes, e, Math.min(cap, budget));
    budget -= part.bytes.length;
    if (part.error) {
      if (part.error !== 'encrypted') sink.add('docx.malformed', { value: `The part ${displayText(name, 60)} could not be read (${part.error})`, source: `DOCX part ${name}`, status: 'suspicious', confidence: 'medium' });
      return null;
    }
    if (part.truncated) partial = true;
    summary.partsRead++;
    return utf8(part.bytes);
  };
  const prop = (xml: string, tag: string, code: string, label: string | undefined, part: string): void => {
    const v = xmpValues(xml, tag)[0];
    if (v) sink.add(code, { label, value: v, source: `${part}, <${tag}>`, location: { kind: 'structure', path: `${part} > ${tag}` } });
  };

  const core = await read('docProps/core.xml');
  if (core) {
    prop(core, 'dc:creator', 'docx.author', undefined, 'docProps/core.xml');
    prop(core, 'cp:lastModifiedBy', 'docx.last-modified-by', undefined, 'docProps/core.xml');
    prop(core, 'dcterms:created', 'docx.created', undefined, 'docProps/core.xml');
    prop(core, 'dcterms:modified', 'docx.modified', undefined, 'docProps/core.xml');
    prop(core, 'dc:title', 'docx.property', 'Title', 'docProps/core.xml');
    prop(core, 'dc:subject', 'docx.property', 'Subject', 'docProps/core.xml');
    prop(core, 'cp:keywords', 'docx.property', 'Keywords', 'docProps/core.xml');
    prop(core, 'dc:description', 'docx.property', 'Description (comments field)', 'docProps/core.xml');
    prop(core, 'cp:category', 'docx.property', 'Category', 'docProps/core.xml');
    prop(core, 'cp:revision', 'docx.revision', undefined, 'docProps/core.xml');
  }
  const app = await read('docProps/app.xml');
  if (app) {
    prop(app, 'Application', 'docx.application', undefined, 'docProps/app.xml');
    prop(app, 'AppVersion', 'docx.application', 'Application version', 'docProps/app.xml');
    prop(app, 'Company', 'docx.company', undefined, 'docProps/app.xml');
    prop(app, 'Manager', 'docx.company', 'Manager', 'docProps/app.xml');
    prop(app, 'Template', 'docx.template', undefined, 'docProps/app.xml');
    prop(app, 'TotalTime', 'docx.editing-time', undefined, 'docProps/app.xml');
  }
  const custom = await read('docProps/custom.xml');
  if (custom) {
    const names = distinctAttr(custom, 'name', 20);
    if (names.length > 0) {
      const values = xmpValues(custom, 'vt:lpwstr').slice(0, 20);
      sink.add('docx.custom', {
        value: `${names.length} propert${names.length === 1 ? 'y' : 'ies'}: ${names.map((n, i) => `${displayText(n, 40)}${values[i] ? ` = ${displayText(values[i]!, 60)}` : ''}`).join('; ')}`,
        source: 'docProps/custom.xml',
        location: { kind: 'structure', path: 'docProps/custom.xml' },
      });
    }
  }
  const types = await read('[Content_Types].xml', 64 * 1024);
  if (types && /macroEnabled|vbaProject/i.test(types)) summary.macroEnabled = true;

  // ---- comments and tracked changes (counts, authors and dates only; text is not shown)
  const comments = await read('word/comments.xml');
  if (comments) {
    const n = count(comments, '<w:comment ');
    if (n > 0) {
      const authors = distinctAttr(comments, 'w:author', 20);
      const dates = distinctAttr(comments, 'w:date', 3);
      sink.add('docx.comments', {
        value: `${n} comment${n === 1 ? '' : 's'}${dates.length ? `, for example dated ${dates.join(', ')}` : ''}. Comment text is not shown here.`,
        source: 'word/comments.xml',
        location: { kind: 'structure', path: 'word/comments.xml' },
      });
      if (authors.length > 0) sink.add('docx.comment-authors', { value: authors.map((a) => displayText(a, 80)).join('; '), source: 'word/comments.xml, w:author', location: { kind: 'structure', path: 'word/comments.xml' } });
    }
  }
  const doc = await read('word/document.xml', 2 * 1024 * 1024);
  if (doc) {
    const ins = count(doc, '<w:ins ');
    const del = count(doc, '<w:del ');
    if (ins + del > 0) {
      const authors = distinctAttr(doc, 'w:author', 20);
      sink.add('docx.tracked-changes', {
        value: `${ins} insertion${ins === 1 ? '' : 's'} and ${del} deletion${del === 1 ? '' : 's'} are recorded. Deleted text may still be stored in the file.`,
        source: 'word/document.xml, w:ins and w:del',
        location: { kind: 'structure', path: 'word/document.xml' },
      });
      if (authors.length > 0) sink.add('docx.tracked-authors', { value: authors.map((a) => displayText(a, 80)).join('; '), source: 'word/document.xml, w:author', location: { kind: 'structure', path: 'word/document.xml' } });
    }
    const hidden = count(doc, '<w:vanish');
    if (hidden > 0) sink.add('docx.hidden-text', { value: `${hidden} run${hidden === 1 ? '' : 's'} formatted as hidden text`, source: 'word/document.xml, w:vanish', location: { kind: 'structure', path: 'word/document.xml' } });
    const rsids = distinctAttr(doc, 'w:rsidR', 5000);
    if (rsids.length > 1) {
      sink.add('docx.rsid', {
        value: `${rsids.length >= 5000 ? 'At least 5,000' : rsids.length} distinct revision-session identifiers`,
        source: 'word/document.xml, w:rsidR',
        location: { kind: 'structure', path: 'word/document.xml' },
      });
    }
  }

  // ---- external references (templates, linked files, links)
  const externals: Array<{ type: string; target: string; part: string }> = [];
  for (const rels of ['word/_rels/document.xml.rels', 'word/_rels/settings.xml.rels', 'word/_rels/footnotes.xml.rels']) {
    const x = await read(rels);
    if (x) for (const r of relationships(x)) if (r.external) externals.push({ type: r.type, target: r.target, part: rels });
  }
  if (externals.length > 0) {
    const links = externals.filter((r) => r.type === 'hyperlink').length;
    const others = externals.filter((r) => r.type !== 'hyperlink');
    sink.add('docx.external', {
      value: `${externals.length} external reference${externals.length === 1 ? '' : 's'} (${links} hyperlink${links === 1 ? '' : 's'}). ${others
        .slice(0, 6)
        .map((r) => `${displayText(r.type, 30)}: ${displayText(r.target, 120)}`)
        .join('; ')}`.trim(),
      source: 'Relationship parts (TargetMode External)',
      location: { kind: 'structure', path: 'word/_rels' },
      limitations: ['Targets are shown as text. They are never opened or followed.'],
    });
  }

  // ---- embedded content and active features by entry name
  const named = (re: RegExp): ZipEntry[] => dir.entries.filter((e) => re.test(e.name));
  const media = named(/^word\/media\//);
  if (media.length > 0) {
    sink.add('docx.media', {
      value: `${media.length} file${media.length === 1 ? '' : 's'}, ${media.reduce((s, e) => s + e.uncompressedSize, 0).toLocaleString('en-US')} bytes declared: ${media.slice(0, 6).map((e) => displayText(e.name.slice(11), 40)).join(', ')}`,
      source: 'DOCX package entries under word/media',
      location: { kind: 'structure', path: 'word/media' },
    });
  }
  const objects = named(/^word\/(embeddings|activeX)\//);
  if (objects.length > 0) {
    sink.add('docx.embedded-objects', { value: `${objects.length} embedded object file${objects.length === 1 ? '' : 's'}: ${objects.slice(0, 6).map((e) => displayText(e.name, 50)).join(', ')}`, source: 'DOCX package entries', location: { kind: 'structure', path: 'word/embeddings' } });
  }
  const thumb = named(/^docProps\/thumbnail\./);
  if (thumb.length > 0) sink.add('docx.thumbnail', { value: `${thumb[0]!.uncompressedSize.toLocaleString('en-US')} bytes declared`, source: 'docProps/thumbnail', location: { kind: 'structure', path: 'docProps/thumbnail' } });
  const customXml = named(/^customXml\//);
  if (customXml.length > 0) sink.add('docx.custom-xml', { value: `${customXml.length} part${customXml.length === 1 ? '' : 's'} under customXml`, source: 'DOCX package entries', location: { kind: 'structure', path: 'customXml' } });
  const macros = named(/vbaProject|\.bin$/i).filter((e) => /vbaProject/i.test(e.name));
  if (macros.length > 0 || summary.macroEnabled) {
    summary.macroEnabled = true;
    sink.add('docx.macros', {
      value: macros.length > 0 ? `A macro project (${displayText(macros[0]!.name, 60)}) is stored in the package` : 'The package declares a macro-enabled content type',
      source: 'DOCX package entries and content types',
      status: macros.length > 0 ? 'verified' : 'inferred',
      limitations: ['The macro project was not opened or analysed, and it is never run.'],
    });
  }
  if (named(/^_xmlsignatures\//).length > 0) sink.add('docx.signature', { value: 'The package contains digital signature parts', source: 'DOCX package entries', status: 'verified' });

  const coverage: CoverageItem[] = [
    { area: 'Package structure', state: dir.invalid || dir.limitHit || dir.zip64 ? 'partial' : 'inspected', note: 'The ZIP directory was read; nothing was extracted to disk and parts are read in memory under size limits.' },
    { area: 'Document properties', state: core || app ? 'inspected' : 'partial', note: 'core, app and custom property parts were read when present.' },
    { area: 'Comments and tracked changes', state: partial ? 'partial' : 'inspected', note: 'Counted with authors and dates. The text of comments and of deleted content is not shown.' },
    { area: 'Revision history', state: 'partial', note: 'Revision-session identifiers are counted; earlier versions are not reconstructed.' },
    { area: 'Media, embedded objects and macros', state: 'partial', note: 'Listed by name and size from the package directory. They are not opened.' },
    { area: 'Document text, headers, footers, footnotes', state: 'not-inspected', note: 'The visible content is not analysed.' },
    { area: 'Content inside embedded files', state: 'not-inspected', note: 'Images and objects inside the package may carry their own metadata.' },
  ];
  sink.coverage.push(...coverage);
  void suspicious;
  return {
    findings: sink.findings,
    coverage: sink.coverage,
    dimensions: null,
    orientation: null,
    structurallyUnsound: dir.invalid !== null,
    copyRefusal: 'Copies are not offered for DOCX files. This tool inspects them only.',
    docx: summary,
  };
}
