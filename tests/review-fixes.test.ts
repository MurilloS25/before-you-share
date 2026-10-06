import { describe, expect, it } from 'vitest';
import { analyseBytes, sha256Hex } from '../src/core/analyze';
import { detectFormat } from '../src/core/detect';
import { analysePng } from '../src/formats/png';
import { scanPdfRaw } from '../src/formats/pdf';
import { xmpValues } from '../src/formats/xmp';
import { createCopy, verifyCopy } from '../src/transform/verify';
import { removalGroupsFor } from '../src/transform/groups';
import { analyseJpeg } from '../src/formats/jpeg';
import { orientationOnlyExifChunk } from '../src/transform/png';
import { analyseFixture, byCode, fixture } from './helpers';
import { baseJpeg, cat, insertSegments, latin, withJfifThumbnail, xmpSegment } from '../fixtures/lib/jpeg';
import { buildPng, chunk } from '../fixtures/lib/png';
import { basicPdf } from '../fixtures/lib/pdf';

describe('JFIF embedded thumbnail', () => {
  it('is reported, removable through "other segments", and the copy verifies', async () => {
    const original = fixture('jpeg-jfif-thumbnail.jpg');
    const r = await analyseFixture('jpeg-jfif-thumbnail.jpg');
    expect(byCode(r, 'jpeg.jfif-thumbnail')).toHaveLength(1);
    const groups = removalGroupsFor(r);
    expect(groups.map((g) => g.id)).toEqual(['other-segments']);
    expect(groups[0]!.defaultOn).toBe(false);
    const res = await createCopy(original, r, ['other-segments']);
    expect(res.verification.allPassed).toBe(true);
    const copy = analyseJpeg(res.output);
    expect(copy.findings.some((f) => f.code === 'jpeg.jfif-thumbnail')).toBe(false);
    expect(copy.findings.some((f) => f.code === 'jpeg.jfif')).toBe(true);
    expect(res.output.length).toBe(original.length - 12);
    expect(res.manifest.entries.some((e) => e.action === 'rewritten' && /JFIF/.test(e.what))).toBe(true);
  });
});

describe('malformed PNG text chunks are never silent', () => {
  it('reports them as removable and removes them from a copy', async () => {
    const original = fixture('png-text-malformed.png');
    const r = await analyseFixture('png-text-malformed.png');
    expect(byCode(r, 'png.text-malformed')).toHaveLength(2);
    expect(byCode(r, 'png.text-malformed')[0]).toMatchObject({ status: 'suspicious', group: 'png-text' });
    expect(removalGroupsFor(r).map((g) => g.id)).toContain('png-text');
    const res = await createCopy(original, r, ['png-text']);
    expect(res.verification.allPassed).toBe(true);
    expect((await analysePng(res.output)).findings.some((f) => f.code === 'png.text-malformed')).toBe(false);
  });

  it('also reports zTXt and iTXt with broken layouts', async () => {
    const z = await analysePng(buildPng({ before: [chunk('zTXt', latin('nokeyword'))] }));
    const i = await analysePng(buildPng({ before: [chunk('iTXt', latin('Key\u0000\u0000\u0000lang-without-terminator'))] }));
    expect(z.findings.some((f) => f.code === 'png.text-malformed')).toBe(true);
    expect(i.findings.some((f) => f.code === 'png.text-malformed')).toBe(true);
  });
});

describe('XMP scanning cost is linear', () => {
  it('handles a 1 MiB packet of repeated openings quickly', () => {
    const t = Date.now();
    expect(xmpValues('<dc:creator>'.repeat(90_000), 'dc:creator')).toEqual([]);
    expect(Date.now() - t).toBeLessThan(500);
    const t2 = Date.now();
    xmpValues(' dc:creator="'.repeat(80_000), 'dc:creator');
    expect(Date.now() - t2).toBeLessThan(500);
  });

  it('still reads element, list, attribute and entity forms', () => {
    const xml = '<x dc:creator="A &amp; B"><dc:title><rdf:Alt><rdf:li xml:lang="x">T1</rdf:li></rdf:Alt></dc:title><dc:rights>R</dc:rights>';
    expect(xmpValues(xml, 'dc:creator')).toEqual(['A & B']);
    expect(xmpValues(xml, 'dc:title')).toEqual(['T1']);
    expect(xmpValues(xml, 'dc:rights')).toEqual(['R']);
  });

  it('a large hostile XMP segment does not stall a JPEG analysis', () => {
    const jpeg = insertSegments(baseJpeg(), [xmpSegment('<dc:creator>'.repeat(5_000))]);
    const t = Date.now();
    analyseJpeg(jpeg);
    expect(Date.now() - t).toBeLessThan(1000);
  });
});

describe('PNG orientation comes from the first eXIf that has one, in analysis and in the copy', () => {
  it('keeps the same value', async () => {
    const png = buildPng({ before: [orientationOnlyExifChunk(6), orientationOnlyExifChunk(3)] });
    const out = await analyseBytes(png, { name: 'x.png', type: '' });
    if (!out.supported) throw new Error('unsupported');
    expect(out.report.orientation).toBe(6);
    const res = await createCopy(png, out.report, ['png-exif']);
    expect(res.verification.checks.find((c) => c.id === 'orientation')!.status).toBe('pass');
    expect((await analysePng(res.output)).orientation).toBe(6);
  });
});

describe('MPF with a removed trailer is called out', () => {
  it('adds a manifest note when trailer is selected but the MPF index is kept', async () => {
    const original = fixture('jpeg-kitchen-sink.jpg');
    const r = await analyseFixture('jpeg-kitchen-sink.jpg');
    const res = await createCopy(original, r, ['trailer']);
    expect(res.manifest.entries.some((e) => /MPF/.test(e.what) && /points at missing data/.test(e.note ?? ''))).toBe(true);
  });
});

describe('PDF raw scan and detection order', () => {
  it('uses the last trailer ID in an updated file', () => {
    const base = basicPdf({ id: false }).w.bytes();
    const updated = cat(base, latin('trailer\n<< /ID [<aa11> <bb22>] >>\n'));
    expect(scanPdfRaw(updated).ids).toEqual(['aa11', 'bb22']);
  });

  it('a ZIP or GIF that merely contains %PDF- early is not treated as a PDF', () => {
    expect(detectFormat(cat(Uint8Array.of(0x50, 0x4b, 3, 4), latin('%PDF-1.7 inside'))).format).toBeNull();
    expect(detectFormat(cat(latin('GIF89a'), latin('%PDF-1.7'))).recognisedUnsupported).toBe(true);
    expect(detectFormat(latin('%PDF-1.7\n')).format).toBe('pdf');
  });
});

describe('verification compares display-affecting bytes', () => {
  it('fails when an ICC profile body is damaged in the copy', async () => {
    const original = fixture('jpeg-icc.jpg');
    const r = await analyseFixture('jpeg-icc.jpg');
    const tampered = Uint8Array.from(original);
    const at = Buffer.from(tampered).indexOf('Example Synthetic Profile');
    tampered[at + 3] = 0x58;
    const v = await verifyCopy(original, await sha256Hex(original), r, tampered, []);
    expect(v.checks.find((c) => c.id === 'display-data')!.status).toBe('fail');
  });

  it('the JFIF thumbnail fixture builder adds exactly the thumbnail bytes', () => {
    expect(withJfifThumbnail(baseJpeg(), 1, 1).length).toBe(baseJpeg().length + 3);
  });
});
