import { displayText, utf8 } from '../core/bytes';
import { FindingSink } from '../core/findings';
import { LIMITS } from '../core/limits';
import type { CoverageItem, DocxSummary } from '../core/types';
import type { FormatAnalysis } from './common';
import { decodeEntities } from './xmp';
import { distinctAttrValues, elementText, findClose, startTags, stripXmlNoise } from './xml';
import { readZipDirectory, readZipEntry, type ZipDirectory, type ZipEntry } from './zip';

export interface DocxAnalysis extends FormatAnalysis {
  docx: DocxSummary;
}

const DOCUMENT_CAP = 2 * 1024 * 1024;

/** True when the ZIP looks like a Word package: it has the content-types part and the main document part. */
export function looksLikeDocx(dir: ZipDirectory): boolean {
  const names = new Set(dir.entries.map((e) => e.name));
  return names.has('[Content_Types].xml') && names.has('word/document.xml');
}

export async function analyseDocx(bytes: Uint8Array, dirIn?: ZipDirectory): Promise<DocxAnalysis> {
  const sink = new FindingSink();
  const dir = dirIn ?? readZipDirectory(bytes);
  const summary: DocxSummary = { entries: dir.entries.length, declaredUncompressed: dir.declaredUncompressed, partsRead: 0, macroEnabled: false, encrypted: false };
  const byName = new Map<string, ZipEntry>();
  for (const e of dir.entries) if (!byName.has(e.name)) byName.set(e.name, e);

  // ---- package health (never extracts to disk; names are text)
  const where = 'DOCX package (ZIP central directory)';
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
    sink.add('docx.zip-suspicious', {
      value: `${dupes} duplicated entry name${dupes === 1 ? '' : 's'}. Only the first of each is read here; other programs may read the last, so they could show different values`,
      source: where,
      status: 'suspicious',
    });
  }
  if (odd.length > 0) {
    sink.add('docx.zip-suspicious', {
      value: `Entry names that climb out of the package or use absolute or backslash paths: ${odd.slice(0, 5).map((n) => displayText(n, 80)).join(', ')}. Nothing is extracted.`,
      source: where,
      status: 'suspicious',
    });
  }
  if (dir.declaredUncompressed > LIMITS.maxZipDeclaredTotal || worstRatio > LIMITS.maxZipRatio) {
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

  // ---- parts we read (bounded, text only; comments, processing instructions and CDATA are normalised first)
  let budget: number = LIMITS.maxZipTotalInflate;
  const truncated = new Set<string>();
  const read = async (name: string, cap: number = LIMITS.maxZipPartBytes): Promise<string | null> => {
    const e = byName.get(name);
    if (!e || budget <= 0) return null;
    const part = await readZipEntry(bytes, e, Math.min(cap, budget));
    budget -= part.bytes.length;
    if (part.error) {
      if (part.error !== 'encrypted') sink.add('docx.malformed', { value: `The part ${displayText(name, 60)} could not be read (${part.error})`, source: `DOCX part ${name}`, status: 'suspicious', confidence: 'medium' });
      return null;
    }
    if (part.truncated) truncated.add(name);
    summary.partsRead++;
    return stripXmlNoise(utf8(part.bytes));
  };
  const atLeast = (part: string): string => (truncated.has(part) ? 'At least ' : '');
  const prop = (xml: string, local: string, code: string, label: string | undefined, part: string): void => {
    const v = elementText(xml, local);
    if (v) sink.add(code, { label, value: v, source: `${part}, <${local}>`, location: { kind: 'structure', path: `${part} > ${local}` } });
  };

  const core = await read('docProps/core.xml');
  if (core) {
    prop(core, 'creator', 'docx.author', undefined, 'docProps/core.xml');
    prop(core, 'lastModifiedBy', 'docx.last-modified-by', undefined, 'docProps/core.xml');
    prop(core, 'created', 'docx.created', undefined, 'docProps/core.xml');
    prop(core, 'modified', 'docx.modified', undefined, 'docProps/core.xml');
    prop(core, 'title', 'docx.property', 'Title', 'docProps/core.xml');
    prop(core, 'subject', 'docx.property', 'Subject', 'docProps/core.xml');
    prop(core, 'keywords', 'docx.property', 'Keywords', 'docProps/core.xml');
    prop(core, 'description', 'docx.property', 'Description (comments field)', 'docProps/core.xml');
    prop(core, 'category', 'docx.property', 'Category', 'docProps/core.xml');
    prop(core, 'revision', 'docx.revision', undefined, 'docProps/core.xml');
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
    const { tags } = startTags(custom, 'property', 500);
    const shown: string[] = [];
    for (const t of tags.slice(0, 20)) {
      const close = t.selfClosing ? -1 : findClose(custom, t);
      const value = close === -1 ? '' : decodeEntities(custom.slice(t.end, close).replace(/<[^>]*>/g, '')).trim();
      shown.push(`${displayText(t.attrs.get('name') ?? '(unnamed)', 40)}${value ? ` = ${displayText(value, 60)}` : ''}`);
    }
    if (tags.length > 0) {
      sink.add('docx.custom', {
        value: `${tags.length} propert${tags.length === 1 ? 'y' : 'ies'}${tags.length > 20 ? ' (first 20 shown)' : ''}: ${shown.join('; ')}`,
        source: 'docProps/custom.xml',
        location: { kind: 'structure', path: 'docProps/custom.xml' },
      });
    }
  }
  const types = await read('[Content_Types].xml', 256 * 1024);
  if (types && /macroEnabled|vbaProject/i.test(types)) summary.macroEnabled = true;

  // ---- comments and tracked changes (counts, authors and dates only; text is not shown)
  const comments = await read('word/comments.xml');
  if (comments) {
    const { values: authors, total: n } = distinctAttrValues(comments, 'comment', 'author', 20);
    const dates = distinctAttrValues(comments, 'comment', 'date', 3).values;
    if (n > 0) {
      sink.add('docx.comments', {
        value: `${atLeast('word/comments.xml')}${n} comment${n === 1 ? '' : 's'}${dates.length ? `, for example dated ${dates.join(', ')}` : ''}. Comment text is not shown here.`,
        source: 'word/comments.xml',
        location: { kind: 'structure', path: 'word/comments.xml' },
      });
      if (authors.length > 0) sink.add('docx.comment-authors', { value: authors.map((a) => displayText(a, 80)).join('; '), source: 'word/comments.xml, w:author', location: { kind: 'structure', path: 'word/comments.xml' } });
    }
  }
  const doc = await read('word/document.xml', DOCUMENT_CAP);
  if (doc) {
    const ins = distinctAttrValues(doc, 'ins', 'author', 20);
    const del = distinctAttrValues(doc, 'del', 'author', 20);
    if (ins.total + del.total > 0) {
      const authors = [...new Set([...ins.values, ...del.values])].slice(0, 20);
      sink.add('docx.tracked-changes', {
        value: `${atLeast('word/document.xml')}${ins.total} insertion${ins.total === 1 ? '' : 's'} and ${del.total} deletion${del.total === 1 ? '' : 's'} are recorded. Deleted text may still be stored in the file.`,
        source: 'word/document.xml, w:ins and w:del',
        location: { kind: 'structure', path: 'word/document.xml' },
        status: truncated.has('word/document.xml') ? 'inferred' : 'verified',
      });
      if (authors.length > 0) sink.add('docx.tracked-authors', { value: authors.map((a) => displayText(a, 80)).join('; '), source: 'word/document.xml, w:author', location: { kind: 'structure', path: 'word/document.xml' } });
    }
    const hidden = startTags(doc, 'vanish', 100_000).tags.filter((t) => !['0', 'false', 'off'].includes(t.attrs.get('val') ?? '')).length;
    if (hidden > 0) sink.add('docx.hidden-text', { value: `${atLeast('word/document.xml')}${hidden} run${hidden === 1 ? '' : 's'} formatted as hidden text`, source: 'word/document.xml, w:vanish', location: { kind: 'structure', path: 'word/document.xml' } });
    const rsids = distinctAttrValues(doc, 'p', 'rsidR', 5000);
    if (rsids.values.length > 1) {
      sink.add('docx.rsid', {
        value: `${rsids.values.length >= 5000 ? 'At least 5,000' : rsids.values.length} distinct revision-session identifiers`,
        source: 'word/document.xml, w:rsidR',
        location: { kind: 'structure', path: 'word/document.xml' },
      });
    }
  }

  // ---- external references (templates, linked files, links)
  const externals: Array<{ type: string; target: string }> = [];
  let relCapped = false;
  for (const rels of ['word/_rels/document.xml.rels', 'word/_rels/settings.xml.rels', 'word/_rels/footnotes.xml.rels']) {
    const x = await read(rels);
    if (!x) continue;
    const { tags, capped } = startTags(x, 'Relationship', 2000);
    relCapped ||= capped;
    for (const t of tags) if (t.attrs.get('TargetMode') === 'External') externals.push({ type: (t.attrs.get('Type') ?? '').split('/').pop() ?? '', target: t.attrs.get('Target') ?? '' });
  }
  if (relCapped) sink.add('docx.limit', { value: 'More than 2,000 relationships in one part; the rest were not examined', source: 'Relationship parts', status: 'unsupported' });
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
  const media = named(/^word\/media\//i);
  if (media.length > 0) {
    sink.add('docx.media', {
      value: `${media.length} file${media.length === 1 ? '' : 's'}, ${media.reduce((s, e) => s + e.uncompressedSize, 0).toLocaleString('en-US')} bytes declared: ${media.slice(0, 6).map((e) => displayText(e.name.slice(11), 40)).join(', ')}`,
      source: 'DOCX package entries under word/media',
      location: { kind: 'structure', path: 'word/media' },
    });
  }
  const objects = named(/^word\/(embeddings|activeX)\//i);
  if (objects.length > 0) {
    sink.add('docx.embedded-objects', { value: `${objects.length} embedded object file${objects.length === 1 ? '' : 's'}: ${objects.slice(0, 6).map((e) => displayText(e.name, 50)).join(', ')}`, source: 'DOCX package entries', location: { kind: 'structure', path: 'word/embeddings' } });
  }
  const thumb = named(/^docProps\/thumbnail\./i);
  if (thumb.length > 0) sink.add('docx.thumbnail', { value: `${thumb[0]!.uncompressedSize.toLocaleString('en-US')} bytes declared`, source: 'docProps/thumbnail', location: { kind: 'structure', path: 'docProps/thumbnail' } });
  const customXml = named(/^customXml\//i);
  if (customXml.length > 0) sink.add('docx.custom-xml', { value: `${customXml.length} part${customXml.length === 1 ? '' : 's'} under customXml`, source: 'DOCX package entries', location: { kind: 'structure', path: 'customXml' } });
  const macros = named(/vbaProject/i);
  if (macros.length > 0 || summary.macroEnabled) {
    summary.macroEnabled = true;
    sink.add('docx.macros', {
      value: macros.length > 0 ? `A macro project (${displayText(macros[0]!.name, 60)}) is stored in the package` : 'The package declares a macro-enabled content type',
      source: 'DOCX package entries and content types',
      status: macros.length > 0 ? 'verified' : 'inferred',
      limitations: ['The macro project was not opened or analysed, and it is never run.'],
    });
  }
  if (named(/^_xmlsignatures\//i).length > 0) sink.add('docx.signature', { value: 'The package contains digital signature parts', source: 'DOCX package entries', status: 'verified' });

  if (truncated.size > 0) {
    sink.add('docx.limit', {
      value: `Parts larger than the reading limit were read only in part: ${[...truncated].map((n) => displayText(n, 50)).join(', ')}. Counts from them may be too low`,
      source: 'Safety limit',
      status: 'unsupported',
    });
  }

  const propsFull = core !== null && app !== null;
  const coverage: CoverageItem[] = [
    { area: 'Package structure', state: dir.invalid || dir.limitHit || dir.zip64 ? 'partial' : 'inspected', note: 'The ZIP directory was read; nothing was extracted to disk and parts are read in memory under size limits. Local headers and the directory were not cross-checked in full.' },
    { area: 'Document properties', state: propsFull ? 'inspected' : 'partial', note: propsFull ? 'core and app property parts were read (custom properties when present).' : 'One of the core or app property parts is missing or could not be read.' },
    { area: 'Comments and tracked changes', state: 'partial', note: 'Only word/document.xml and word/comments.xml were examined. Headers, footers, footnotes, endnotes and extended comment parts were not. Text of comments and deleted content is not shown.' },
    { area: 'Revision history', state: 'partial', note: 'Revision-session identifiers are counted; earlier versions are not reconstructed.' },
    { area: 'Media, embedded objects and macros', state: 'partial', note: 'Listed by name and size from the package directory. They are not opened.' },
    { area: 'Document text, headers, footers, footnotes', state: 'not-inspected', note: 'The visible content is not analysed.' },
    { area: 'Content inside embedded files', state: 'not-inspected', note: 'Images and objects inside the package may carry their own metadata.' },
  ];
  sink.coverage.push(...coverage);
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
