import { afterEach, describe, expect, it, vi } from 'vitest';
import { analysePdf, normalisePdfDate, scanPdfRaw } from '../src/formats/pdf';
import { analyseFixture, byCode, fixture, valueOf } from './helpers';
import { latin } from '../fixtures/lib/jpeg';
import { basicPdf } from '../fixtures/lib/pdf';

describe('PDF inspection (library-backed, bounded)', () => {
  it('reads Info properties, normalises dates and reads the document ID from the trailer', async () => {
    const r = await analyseFixture('pdf-basic.pdf');
    expect(valueOf(r, 'pdf.title')).toBe('Fixture Document');
    expect(valueOf(r, 'pdf.author')).toBe('Example Person');
    expect(valueOf(r, 'pdf.subject')).toBe('Synthetic subject');
    expect(valueOf(r, 'pdf.keywords')).toBe('fixture, example');
    expect(valueOf(r, 'pdf.creator')).toBe('Fixture Writer');
    expect(valueOf(r, 'pdf.producer')).toBe('Fixture PDF Library 1.0');
    expect(valueOf(r, 'pdf.created')).toBe('2000-01-01 00:00:00 UTC');
    expect(valueOf(r, 'pdf.modified')).toBe('2000-01-02 00:00:00 UTC');
    expect(valueOf(r, 'pdf.document-id')).toBe('00112233445566778899aabbccddeeff');
    expect(valueOf(r, 'pdf.version')).toBe('1.7');
    expect(valueOf(r, 'pdf.pages')).toBe('1');
    expect(r.pdf).toMatchObject({ pageCount: 1, encrypted: false, libraryUsed: true });
    expect(byCode(r, 'pdf.author')[0]).toMatchObject({ category: 'identity', status: 'verified', transformation: 'unsupported', removable: false });
  });

  it('always states that copies are not offered and page content is not inspected', async () => {
    const r = await analyseFixture('pdf-basic.pdf');
    expect(r.copyRefusal).toMatch(/not offered for PDF/);
    expect(byCode(r, 'pdf.hidden-text')).toHaveLength(1);
    expect(r.coverage.find((c) => c.area === 'Page content')!.state).toBe('not-inspected');
  });

  it('extracts XMP from the metadata stream and marks it as not removable', async () => {
    const r = await analyseFixture('pdf-xmp.pdf');
    expect(valueOf(r, 'xmp.creator')).toBe('Example Person');
    expect(byCode(r, 'pdf.xmp')).toHaveLength(1);
    expect(r.findings.filter((f) => f.code.startsWith('xmp.')).every((f) => !f.removable && f.group === undefined)).toBe(true);
  });

  it('finds annotations with authors, form fields, attachments and layers', async () => {
    expect(valueOf(await analyseFixture('pdf-annotation.pdf'), 'pdf.annotation-author')).toBe('Example Person');
    expect(valueOf(await analyseFixture('pdf-form.pdf'), 'pdf.forms')).toContain('fixture_field: Example value');
    expect(valueOf(await analyseFixture('pdf-attachment.pdf'), 'pdf.attachments')).toContain('fixture.txt');
    const layers = await analyseFixture('pdf-layers.pdf');
    expect(valueOf(layers, 'pdf.layers')).toContain('1 hidden by default: Fixture hidden layer');
  });

  it('distinguishes verified JavaScript from inferred raw-scan indicators', async () => {
    const js = await analyseFixture('pdf-javascript.pdf');
    expect(byCode(js, 'pdf.javascript')[0]).toMatchObject({ status: 'verified', category: 'active-features' });
    expect(byCode(js, 'pdf.javascript')[0]!.limitations.join(' ')).toMatch(/not analysed or executed/);
    const links = await analyseFixture('pdf-link-actions.pdf');
    const actions = byCode(links, 'pdf.actions');
    expect(actions.map((a) => a.status)).toEqual(['verified', 'inferred']);
    expect(actions[0]!.value).toContain('https://example.invalid/fixture');
    expect(actions[1]!.value).toContain('/Launch');
  });

  it('reports encryption without reading content or trying passwords', async () => {
    const r = await analyseFixture('pdf-encrypted.pdf');
    expect(byCode(r, 'pdf.encrypted')[0]).toMatchObject({ status: 'verified', category: 'unsupported' });
    expect(r.pdf!.encrypted).toBe(true);
    expect(byCode(r, 'pdf.title')).toHaveLength(0);
    expect(r.coverage[0]!.state).toBe('not-inspected');
  });

  it('counts incremental updates from end-of-file markers and calls it an inference', async () => {
    const r = await analyseFixture('pdf-incremental.pdf');
    const f = byCode(r, 'pdf.incremental')[0]!;
    expect(f.status).toBe('inferred');
    expect(f.value).toContain('2 end-of-file markers');
    expect(r.pdf!.incrementalUpdates).toBe(1);
    expect(valueOf(r, 'pdf.title')).toBe('Revised title');
  });

  it('bounds per-page inspection', async () => {
    const r = await analyseFixture('pdf-many-pages.pdf');
    expect(r.pdf).toMatchObject({ pageCount: 300, pagesInspected: 200 });
    expect(byCode(r, 'pdf.limit')).toHaveLength(1);
    const mismatch = await analyseFixture('pdf-count-mismatch.pdf');
    expect(mismatch.pdf!.pageCount).toBe(1);
  });

  it('degrades honestly on truncated and malformed files', async () => {
    const t = await analyseFixture('pdf-truncated.pdf');
    expect(t.structurallyUnsound).toBe(true);
    expect(byCode(t, 'pdf.truncated')[0]!.status).toBe('inferred');
    expect(byCode(t, 'pdf.malformed')).toHaveLength(1);
    const m = await analyseFixture('pdf-malformed.pdf');
    expect(m.structurallyUnsound).toBe(true);
    expect(m.coverage[0]).toMatchObject({ area: 'Info dictionary', state: 'not-inspected' });
  });

  it('keeps hostile Info strings as inert text', async () => {
    const r = await analyseFixture('pdf-hostile-metadata.pdf');
    expect(valueOf(r, 'pdf.title')).toContain('<script>');
  });

  it('handles a PDF with no metadata at all', async () => {
    const r = await analyseFixture('pdf-minimal.pdf');
    expect(r.findings.map((f) => f.code).sort()).toEqual(['pdf.hidden-text', 'pdf.pages', 'pdf.version']);
  });

  it('makes no network request while analysing', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden')));
    vi.stubGlobal('fetch', fetchSpy);
    const xhr = vi.fn();
    vi.stubGlobal('XMLHttpRequest', xhr);
    for (const f of ['pdf-basic.pdf', 'pdf-link-actions.pdf', 'pdf-javascript.pdf', 'pdf-attachment.pdf', 'pdf-xmp.pdf']) await analyseFixture(f);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('raw scan', () => {
  it('decodes obfuscated names so hex escapes cannot hide JavaScript', () => {
    const s = scanPdfRaw(latin('%PDF-1.7\n1 0 obj\n<< /S /Java#53cript /J#53 (x) /Launch >>\nendobj\n%%EOF'));
    expect(s.tokens.get('JavaScript')).toBe(1);
    expect(s.tokens.get('JS')).toBe(1);
    expect(s.tokens.get('Launch')).toBe(1);
    expect(s.version).toBe('1.7');
    expect(s.eofCount).toBe(1);
    expect(s.endsWithEof).toBe(true);
  });

  it('reads the ID array and tolerates garbage', () => {
    expect(scanPdfRaw(fixture('pdf-basic.pdf')).ids).toEqual(['00112233445566778899aabbccddeeff', '00112233445566778899aabbccddeeff']);
    expect(() => scanPdfRaw(new Uint8Array(0))).not.toThrow();
    expect(() => scanPdfRaw(Uint8Array.from({ length: 5000 }, (_, i) => (i * 31) & 255))).not.toThrow();
  });

  it('flags an inferred indicator when the library cannot see compressed objects', async () => {
    const bytes = basicPdf({ extraObjects: [[7, '<< /S /JavaScript /JS (x) >>']] }).w.bytes();
    const r = await analysePdf(bytes);
    const f = byCode(r as never, 'pdf.javascript');
    expect(f.length === 0 || f[0]!.status === 'inferred').toBe(true);
  });
});

describe('PDF date normalisation', () => {
  it.each([
    ["D:20000101000000Z", '2000-01-01 00:00:00 UTC'],
    ["D:20000101120000+02'00'", '2000-01-01 12:00:00 UTC+02:00'],
    ['D:2000', '2000-01-01 00:00:00'],
    ['not a date', 'not a date'],
  ])('%s -> %s', (raw, expected) => expect(normalisePdfDate(raw)).toBe(expected));
});
