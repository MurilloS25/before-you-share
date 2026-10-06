import { latin1, displayText } from '../core/bytes';
import { FindingSink } from '../core/findings';
import { LIMITS } from '../core/limits';
import type { CoverageItem, PdfSummary } from '../core/types';
import { analyseXmp } from './xmp';
import type { FormatAnalysis } from './common';

export interface PdfAnalysis extends FormatAnalysis {
  pdf: PdfSummary;
}

/** Facts from a bounded scan of raw bytes. Indicators only: compressed objects are invisible to it. */
export interface RawScan {
  version: string | null;
  eofCount: number;
  tokens: Map<string, number>;
  ids: [string, string] | null;
  idIsLiteral: boolean;
  endsWithEof: boolean;
}

const WATCH = new Set([
  'JavaScript', 'JS', 'Launch', 'OpenAction', 'AA', 'URI', 'SubmitForm', 'ImportData', 'GoToR', 'GoToE',
  'EmbeddedFile', 'EmbeddedFiles', 'AcroForm', 'XFA', 'RichMedia', 'Encrypt', 'ByteRange', 'ObjStm',
  'Linearized', 'Annots', 'Metadata', 'OCProperties', 'Movie', 'Sound', '3D',
]);
const DELIMS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20, 0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

export function scanPdfRaw(bytes: Uint8Array): RawScan {
  const scan: RawScan = { version: null, eofCount: 0, tokens: new Map(), ids: null, idIsLiteral: false, endsWithEof: false };
  const head = latin1(bytes.subarray(0, Math.min(bytes.length, 1032)));
  const m = /%PDF-(\d\.\d)/.exec(head);
  if (m) scan.version = m[1]!;

  // %%EOF markers.
  const eof = [0x25, 0x25, 0x45, 0x4f, 0x46];
  let i = bytes.indexOf(0x25);
  while (i !== -1) {
    if (bytes[i + 1] === eof[1] && bytes[i + 2] === eof[2] && bytes[i + 3] === eof[3] && bytes[i + 4] === eof[4]) scan.eofCount++;
    i = bytes.indexOf(0x25, i + 1);
  }
  const tail = latin1(bytes.subarray(Math.max(0, bytes.length - 1024)));
  scan.endsWithEof = tail.includes('%%EOF');

  // Name tokens, decoding #xx escapes so that obfuscated names such as /Java#53cript still match.
  let p = bytes.indexOf(0x2f);
  while (p !== -1) {
    let name = '';
    let q = p + 1;
    while (q < bytes.length && name.length < 48 && !DELIMS.has(bytes[q]!)) {
      const c = bytes[q]!;
      if (c === 0x23 && q + 2 < bytes.length) {
        const hex = String.fromCharCode(bytes[q + 1]!, bytes[q + 2]!);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          name += String.fromCharCode(parseInt(hex, 16));
          q += 3;
          continue;
        }
      }
      name += String.fromCharCode(c);
      q++;
    }
    if (WATCH.has(name)) scan.tokens.set(name, (scan.tokens.get(name) ?? 0) + 1);
    if (name === 'ID' && scan.ids === null && q < bytes.length) {
      const look = latin1(bytes.subarray(q, Math.min(bytes.length, q + 200)));
      const hex = /^\s*\[\s*<([0-9a-fA-F\s]{2,128})>\s*<([0-9a-fA-F\s]{2,128})>\s*\]/.exec(look);
      if (hex) scan.ids = [hex[1]!.replace(/\s/g, '').toLowerCase(), hex[2]!.replace(/\s/g, '').toLowerCase()];
      else if (/^\s*\[\s*\(/.test(look)) scan.idIsLiteral = true;
    }
    p = bytes.indexOf(0x2f, Math.max(q, p + 1));
  }
  return scan;
}

export function normalisePdfDate(raw: string): string {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?(?:\d{2})?'?)?/.exec(raw.trim());
  if (!m) return raw;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', tz] = m;
  let zone = '';
  if (tz === 'Z') zone = ' UTC';
  else if (tz) zone = ` UTC${tz.replace(/'/g, '').replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')}`;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}${zone}`;
}

interface PdfJsDoc {
  numPages: number;
  fingerprints: Array<string | null>;
  getMetadata(): Promise<{ info: Record<string, unknown>; metadata: { getRaw(): string } | null }>;
  getAttachments(): Promise<Map<string, { filename?: string }> | null>;
  getJSActions(): Promise<Map<string, unknown> | null>;
  hasJSActions(): Promise<boolean>;
  getFieldObjects(): Promise<Map<string, Array<{ type?: string; value?: unknown }>> | null>;
  getOptionalContentConfig(): Promise<Iterable<[string, { name: string; visible: boolean }]>>;
  getPage(n: number): Promise<{
    getAnnotations(): Promise<Array<Record<string, any>>>;
    getJSActions(): Promise<unknown>;
    cleanup(): void;
  }>;
}
interface PdfJsTask {
  promise: Promise<PdfJsDoc>;
  destroy(): Promise<void>;
}

let libraryPromise: Promise<{ getDocument: (o: Record<string, unknown>) => PdfJsTask }> | null = null;

/** Loads pdf.js and runs its parser on this thread (the analysis worker), never on the UI thread. */
export function loadPdfLibrary() {
  libraryPromise ??= (async () => {
    const [lib, worker] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ]);
    // Providing the handler up front makes pdf.js use it in-thread and never create a Worker or fetch a script.
    (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = { WorkerMessageHandler: (worker as { WorkerMessageHandler: unknown }).WorkerMessageHandler };
    return lib as unknown as { getDocument: (o: Record<string, unknown>) => PdfJsTask };
  })();
  return libraryPromise;
}

export const PDFJS_OPTIONS = {
  isEvalSupported: false,
  useSystemFonts: false,
  disableFontFace: true,
  useWorkerFetch: false,
  enableXfa: false,
  stopAtErrors: false,
  maxImageSize: 16_000_000,
  verbosity: 0,
} as const;

export async function analysePdf(bytes: Uint8Array): Promise<PdfAnalysis> {
  const sink = new FindingSink();
  const raw = scanPdfRaw(bytes);
  const tok = (n: string): number => raw.tokens.get(n) ?? 0;
  const summary: PdfSummary = {
    version: raw.version,
    pageCount: null,
    pagesInspected: 0,
    encrypted: false,
    incrementalUpdates: null,
    libraryUsed: false,
  };

  let docOk = false;
  let encrypted = false;
  let malformed = false;
  let libraryFailed = false;
  let jsVerified = false;
  let actionsVerified = false;

  const struct = (path: string) => ({ kind: 'structure' as const, path });

  let task: PdfJsTask | null = null;
  try {
    const lib = await loadPdfLibrary();
    // A copy is passed because pdf.js may transfer the buffer to its worker.
    task = lib.getDocument({ ...PDFJS_OPTIONS, data: new Uint8Array(bytes) });
    const doc = await task.promise;
    docOk = true;
    summary.libraryUsed = true;
    summary.pageCount = doc.numPages;

    const { info, metadata } = await doc.getMetadata();
    const str = (k: string): string | null => {
      const v = info[k];
      return typeof v === 'string' && v.trim() !== '' ? v : null;
    };
    const emit = (code: string, key: string, value: string | null, normalise?: (s: string) => string): void => {
      if (value === null) return;
      sink.add(code, { value: normalise ? normalise(value) : value, source: `PDF Info dictionary, /${key}`, location: struct(`Trailer > Info > ${key}`) });
    };
    emit('pdf.title', 'Title', str('Title'));
    emit('pdf.author', 'Author', str('Author'));
    emit('pdf.subject', 'Subject', str('Subject'));
    emit('pdf.keywords', 'Keywords', str('Keywords'));
    emit('pdf.creator', 'Creator', str('Creator'));
    emit('pdf.producer', 'Producer', str('Producer'));
    emit('pdf.created', 'CreationDate', str('CreationDate'), normalisePdfDate);
    emit('pdf.modified', 'ModDate', str('ModDate'), normalisePdfDate);
    const custom = info['Custom'];
    if (custom && typeof custom === 'object') {
      const entries = Object.entries(custom as Record<string, unknown>).slice(0, 10);
      if (entries.length > 0) {
        sink.add('pdf.custom', {
          value: entries.map(([k, v]) => `${displayText(k, 40)}: ${displayText(String(v), 80)}`).join('; '),
          source: 'PDF Info dictionary, custom keys',
          location: struct('Trailer > Info'),
        });
      }
    }
    const libVersion = typeof info['PDFFormatVersion'] === 'string' ? (info['PDFFormatVersion'] as string) : null;
    if (libVersion && !summary.version) summary.version = libVersion;
    if (info['IsSignaturesPresent'] === true) {
      sink.add('pdf.signature', { value: 'The document contains at least one signature field', source: 'PDF library flag', status: 'verified' });
    }
    if (info['IsAcroFormPresent'] === true) summary.pageCount ??= doc.numPages;

    if (metadata) {
      const xml = new TextEncoder().encode(metadata.getRaw().slice(0, LIMITS.maxXmpBytes));
      analyseXmp(xml, sink, 'PDF catalog, /Metadata stream', struct('Catalog > Metadata'), 'pdf.xmp');
    } else if (tok('Metadata') > 0) {
      sink.add('pdf.xmp', { value: 'A /Metadata entry is present but could not be read as XMP', source: 'Raw scan', status: 'inferred', confidence: 'low' });
    }

    // Document IDs come from the raw trailer (the library derives its own hash when the file has no ID).
    if (raw.ids) {
      const same = raw.ids[0] === raw.ids[1];
      sink.add('pdf.document-id', {
        value: `${raw.ids[0]}${same ? '' : ` (current: ${raw.ids[1]})`}`,
        source: 'PDF trailer, /ID',
        location: struct('Trailer > ID'),
        limitations: same ? [] : ['The two IDs differ, which usually means the file was changed after it was first created.'],
      });
    } else if (raw.idIsLiteral) {
      sink.add('pdf.document-id', { value: 'An /ID in literal-string form is present', source: 'PDF trailer, /ID', status: 'inferred', confidence: 'medium' });
    }

    // Attachments (names only; contents are never extracted).
    const att = await doc.getAttachments();
    if (att && att.size > 0) {
      sink.add('pdf.attachments', {
        value: `${att.size} file${att.size === 1 ? '' : 's'}: ${[...att.values()].slice(0, 10).map((a) => displayText(a.filename ?? 'unnamed', 80)).join(', ')}`,
        source: 'PDF library, document attachments',
        location: struct('Catalog > Names > EmbeddedFiles'),
      });
    }

    // Document-level actions and JavaScript.
    const js = await doc.getJSActions();
    let hasJs = js !== null && js.size > 0;
    try {
      hasJs = hasJs || (await doc.hasJSActions());
    } catch {
      /* method may be unavailable; keep the earlier answer */
    }
    if (hasJs) {
      jsVerified = true;
      sink.add('pdf.javascript', {
        value: js && js.size > 0 ? `Document-level trigger${js.size === 1 ? '' : 's'}: ${[...js.keys()].slice(0, 6).map((k) => displayText(k, 30)).join(', ')}` : 'JavaScript actions are present',
        source: 'PDF library, JavaScript actions',
        status: 'verified',
      });
    }

    // Pages: annotations, widgets, links (bounded).
    const limit = Math.min(doc.numPages, LIMITS.maxPdfPagesInspected);
    const subtypes = new Map<string, number>();
    const authors = new Set<string>();
    const urls = new Set<string>();
    let widgetActions = 0;
    let pageScripts = 0;
    for (let n = 1; n <= limit; n++) {
      const page = await doc.getPage(n);
      const anns = await page.getAnnotations();
      for (const a of anns) {
        const st = String(a['subtype'] ?? 'Unknown');
        subtypes.set(st, (subtypes.get(st) ?? 0) + 1);
        const t = (a['titleObj'] as { str?: string } | undefined)?.str;
        if (t && t.trim()) authors.add(t.trim());
        const u = (a['url'] ?? a['unsafeUrl']) as string | undefined;
        if (u && urls.size < 20) urls.add(u);
        if (a['actions']) widgetActions++;
      }
      const pj = await page.getJSActions();
      if (pj) pageScripts++;
      page.cleanup();
    }
    summary.pagesInspected = limit;
    const annTotal = [...subtypes.entries()].filter(([k]) => k !== 'Widget' && k !== 'Link');
    if (annTotal.length > 0) {
      sink.add('pdf.annotations', {
        value: annTotal.map(([k, v]) => `${displayText(k, 30)} × ${v}`).join(', '),
        source: `PDF library, annotations on the first ${limit} page${limit === 1 ? '' : 's'}`,
        location: struct('Page > Annots'),
      });
    }
    if (authors.size > 0) {
      sink.add('pdf.annotation-author', {
        value: [...authors].slice(0, 10).join('; '),
        source: 'PDF library, annotation /T entries',
        location: struct('Page > Annots > T'),
      });
    }
    const fields = await doc.getFieldObjects();
    if (fields && fields.size > 0) {
      const sample = [...fields.entries()].slice(0, 10).map(([name, f]) => {
        const v = f[0]?.value;
        const shown = typeof v === 'string' && v !== '' ? `: ${displayText(v, 60)}` : '';
        return `${displayText(name, 40)}${shown}`;
      });
      sink.add('pdf.forms', {
        value: `${fields.size} field${fields.size === 1 ? '' : 's'} (${sample.join('; ')})`,
        source: 'PDF library, AcroForm fields',
        location: struct('Catalog > AcroForm'),
      });
    } else if (subtypes.get('Widget')) {
      sink.add('pdf.forms', { value: `${subtypes.get('Widget')} widget annotation${subtypes.get('Widget') === 1 ? '' : 's'}`, source: 'PDF library, annotations', location: struct('Page > Annots') });
    }
    if (widgetActions > 0 || pageScripts > 0) {
      jsVerified = true;
      sink.add('pdf.javascript', {
        value: `${widgetActions + pageScripts} page or field trigger${widgetActions + pageScripts === 1 ? '' : 's'}`,
        source: 'PDF library, page and widget actions',
        status: 'verified',
      });
    }
    if (urls.size > 0) {
      actionsVerified = true;
      sink.add('pdf.actions', {
        value: `Link${urls.size === 1 ? '' : 's'} to ${[...urls].slice(0, 5).map((u) => displayText(u, 100)).join(', ')}${urls.size > 5 ? ` and ${urls.size - 5} more` : ''}`,
        source: 'PDF library, link annotations',
        location: struct('Page > Annots > A'),
        status: 'verified',
      });
    }

    // Optional content (layers).
    try {
      const cfg = await doc.getOptionalContentConfig();
      const layers: Array<{ name: string; visible: boolean }> = [];
      for (const [, g] of cfg) layers.push({ name: g.name, visible: g.visible });
      if (layers.length > 0) {
        const hidden = layers.filter((l) => !l.visible).length;
        sink.add('pdf.layers', {
          value: `${layers.length} layer${layers.length === 1 ? '' : 's'}, ${hidden} hidden by default: ${layers.slice(0, 6).map((l) => displayText(l.name, 40)).join(', ')}`,
          source: 'PDF library, optional content groups',
          location: struct('Catalog > OCProperties'),
        });
      }
    } catch {
      /* layers are optional extra detail */
    }
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'PasswordException') {
      encrypted = true;
      summary.encrypted = true;
      sink.add('pdf.encrypted', {
        value: 'A password is required to open this document',
        source: 'PDF library',
        status: 'verified',
        location: struct('Trailer > Encrypt'),
      });
    } else if (name === 'InvalidPDFException' || name === 'FormatError' || name === 'MissingPDFException') {
      malformed = true;
      sink.add('pdf.malformed', { value: 'The library rejected the document structure', source: 'PDF library', status: 'suspicious' });
    } else {
      libraryFailed = true;
      malformed = true;
      sink.add('pdf.malformed', { value: 'The library could not complete the inspection', source: 'PDF library', status: 'unavailable', confidence: 'low' });
    }
  } finally {
    try {
      await task?.destroy();
    } catch {
      /* ignore teardown errors */
    }
  }
  void libraryFailed;

  // ---- raw scan indicators (inferred), only for features the library did not already confirm
  if (!encrypted && tok('Encrypt') > 0 && docOk) {
    sink.add('pdf.encrypted', { value: 'An /Encrypt entry is present, but the document opened without a password', source: 'Raw scan', status: 'inferred', confidence: 'medium' });
  }
  if (encrypted === false && !docOk && tok('Encrypt') > 0) {
    sink.add('pdf.encrypted', { value: 'An /Encrypt entry is present', source: 'Raw scan', status: 'inferred', confidence: 'medium' });
  }
  if (!jsVerified && tok('JavaScript') + tok('JS') > 0) {
    sink.add('pdf.javascript', {
      value: `${tok('JavaScript') + tok('JS')} occurrence${tok('JavaScript') + tok('JS') === 1 ? '' : 's'} of /JavaScript or /JS in the raw bytes`,
      source: 'Raw scan of the file',
      status: 'inferred',
      confidence: 'medium',
    });
  }
  const actionNames = ['Launch', 'OpenAction', 'AA', 'SubmitForm', 'ImportData', 'GoToR', 'GoToE'].filter((n) => tok(n) > 0);
  const uriOnly = tok('URI') > 0 && !actionsVerified;
  if (actionNames.length > 0 || uriOnly) {
    const names = [...actionNames, ...(uriOnly ? ['URI'] : [])];
    sink.add('pdf.actions', {
      value: `Names found in the raw bytes: ${names.map((n) => `/${n} × ${tok(n)}`).join(', ')}`,
      source: 'Raw scan of the file',
      status: 'inferred',
      confidence: 'medium',
    });
  }
  const att = sink.findings.some((f) => f.code === 'pdf.attachments');
  if (!att && tok('EmbeddedFile') + tok('EmbeddedFiles') > 0) {
    sink.add('pdf.attachments', { value: 'An /EmbeddedFile entry exists in the raw bytes', source: 'Raw scan of the file', status: 'inferred', confidence: 'medium' });
  }
  if (!sink.findings.some((f) => f.code === 'pdf.signature') && tok('ByteRange') > 0) {
    sink.add('pdf.signature', { value: 'A /ByteRange entry (used by signatures) is present', source: 'Raw scan of the file', status: 'inferred', confidence: 'medium' });
  }
  for (const [n, label] of [['RichMedia', 'rich media'], ['Movie', 'movie'], ['Sound', 'sound'], ['3D', '3D content'], ['XFA', 'XFA forms']] as const) {
    if (tok(n) > 0) {
      sink.add('pdf.raw-token', { label: `Possible ${label}`, value: `/${n} found in the raw bytes`, source: 'Raw scan of the file', status: 'inferred', confidence: 'low' });
    }
  }

  // ---- structure
  const linearized = tok('Linearized') > 0;
  const revisions = Math.max(0, raw.eofCount - (linearized ? 2 : 1));
  summary.incrementalUpdates = raw.eofCount === 0 ? null : revisions;
  if (revisions > 0) {
    sink.add('pdf.incremental', {
      value: `${raw.eofCount} end-of-file markers, so the file was probably saved at least ${revisions} more time${revisions === 1 ? '' : 's'} on top of its first version`,
      source: 'Raw scan of the file',
      status: 'inferred',
      confidence: 'medium',
    });
  }
  if (!raw.endsWithEof) {
    sink.add('pdf.truncated', { value: 'No end-of-file marker near the end of the file', source: 'Raw scan of the file', status: 'inferred', confidence: 'medium' });
  }
  if (summary.version) {
    sink.add('pdf.version', { value: summary.version, source: 'PDF header', location: { kind: 'bytes', offset: 0, length: 8 } });
  }
  if (summary.pageCount !== null) {
    sink.add('pdf.pages', {
      value: `${summary.pageCount}${summary.pageCount > LIMITS.maxPdfPagesInspected ? ` (annotations and actions were checked on the first ${LIMITS.maxPdfPagesInspected})` : ''}`,
      source: 'PDF library',
    });
  }
  if (summary.pageCount !== null && summary.pageCount > LIMITS.maxPdfPagesInspected) {
    sink.add('pdf.limit', { value: `Only the first ${LIMITS.maxPdfPagesInspected} of ${summary.pageCount} pages were examined for annotations and actions`, source: 'Safety limit', status: 'unsupported' });
  }
  sink.add('pdf.hidden-text', { value: null, source: 'Scope of this tool', status: 'unsupported', group: null });

  const objStm = tok('ObjStm') > 0;
  const coverage: CoverageItem[] = [
    { area: 'Info dictionary', state: docOk ? 'inspected' : 'not-inspected', note: docOk ? 'Read through the PDF library.' : 'The library could not open the document, so properties were not read.' },
    { area: 'XMP metadata', state: docOk ? 'partial' : 'not-inspected', note: 'Well-known XMP properties were extracted.' },
    { area: 'Annotations, forms and links', state: docOk ? (summary.pageCount !== null && summary.pageCount > LIMITS.maxPdfPagesInspected ? 'partial' : 'inspected') : 'not-inspected', note: `Checked on up to ${LIMITS.maxPdfPagesInspected} pages.` },
    { area: 'Attachments', state: docOk ? 'partial' : 'not-inspected', note: 'File names were listed. Attachment contents were never opened.' },
    { area: 'JavaScript and actions', state: 'partial', note: 'Detected through the library and a raw scan. Script code is never run or analysed.' },
    { area: 'Earlier revisions', state: 'partial', note: 'Update markers were counted. Previous versions of objects were not reconstructed.' },
    { area: 'Raw structure scan', state: objStm ? 'partial' : 'inspected', note: objStm ? 'The file uses compressed object streams, which a raw scan cannot see into.' : 'Names in the raw bytes were counted. Compressed streams are not searched.' },
    { area: 'Page content', state: 'not-inspected', note: 'Text, images and drawings on pages are not analysed.' },
  ];
  if (encrypted) coverage.unshift({ area: 'Encrypted content', state: 'not-inspected', note: 'The document is encrypted. This tool does not try passwords.' });
  sink.coverage.push(...coverage);

  return {
    findings: sink.findings,
    coverage: sink.coverage,
    dimensions: null,
    orientation: null,
    structurallyUnsound: malformed || !raw.endsWithEof,
    copyRefusal: 'Copies are not offered for PDF files. This tool inspects PDFs only.',
    pdf: summary,
  };
}
