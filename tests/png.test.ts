import { describe, expect, it } from 'vitest';
import { analysePng, scanPng, classifyChunk } from '../src/formats/png';
import { inflateBounded } from '../src/formats/inflate';
import { analyseFixture, byCode, fixture, valueOf } from './helpers';
import { buildPng, chunk, ihdr, PNG_SIG, idatFor, iend } from '../fixtures/lib/png';
import { cat, latin } from '../fixtures/lib/jpeg';
import { deflateSync } from 'node:zlib';

describe('PNG inspection', () => {
  it('reports a clean PNG with only structural findings', async () => {
    const r = await analyseFixture('png-clean.png');
    expect(r.findings.map((f) => f.code)).toEqual(['image.dimensions']);
    expect(r.dimensions).toEqual({ width: 64, height: 48 });
    expect(r.copyRefusal).toBeNull();
  });

  it('decodes tEXt entries and maps well-known keywords to categories', async () => {
    const r = await analyseFixture('png-text.png');
    expect(byCode(r, 'png.text-author')[0]).toMatchObject({ value: 'Example Person', category: 'identity', group: 'png-text' });
    expect(byCode(r, 'png.text-software')[0]!.category).toBe('device-software');
    expect(byCode(r, 'png.text-time')[0]!.category).toBe('time');
    expect(byCode(r, 'png.text')[0]).toMatchObject({ label: 'Text entry “Comment”', value: 'Synthetic comment' });
  });

  it('decodes compressed zTXt and international iTXt (compressed and not)', async () => {
    expect(valueOf(await analyseFixture('png-ztxt.png'), 'png.text')).toBe('Compressed synthetic description by Example Person');
    const r = await analyseFixture('png-itxt.png');
    expect(byCode(r, 'png.text').map((f) => f.value)).toEqual(['Título de ejemplo ✓ — 例', 'Comentario comprimido ✓']);
  });

  it('decodes eXIf, including GPS, with a PNG-specific removal group', async () => {
    const r = await analyseFixture('png-exif.png');
    expect(valueOf(r, 'exif.gps-position')).toBe('0.250000° N, 0.750000° E');
    expect(byCode(r, 'exif.make')[0]!.group).toBe('png-exif');
  });

  it('decodes tIME, pHYs, iCCP and XMP', async () => {
    expect(valueOf(await analyseFixture('png-time.png'), 'png.time')).toBe('2000-01-02 03:04:05 UTC');
    expect(valueOf(await analyseFixture('png-phys.png'), 'png.phys')).toContain('2835 × 2835 pixels per metre');
    expect(byCode(await analyseFixture('png-icc.png'), 'icc.profile')[0]!.value).toContain('Example Synthetic Profile');
    const x = await analyseFixture('png-xmp.png');
    expect(valueOf(x, 'xmp.creator')).toBe('Example Person');
    expect(byCode(x, 'xmp.creator')[0]!.group).toBe('png-text');
  });

  it('lists unknown and software-specific chunks without decoding them', async () => {
    const r = await analyseFixture('png-unknown-chunk.png');
    expect(byCode(r, 'png.unknown-chunk')[0]).toMatchObject({ status: 'unsupported', group: 'png-unknown' });
    expect(byCode(r, 'png.known-private')[0]).toMatchObject({ status: 'inferred' });
    expect(byCode(r, 'png.known-private')[0]!.value).toContain('caBX');
  });

  it('detects an invalid CRC and continues reading', async () => {
    const r = await analyseFixture('png-bad-crc.png');
    expect(byCode(r, 'png.crc-invalid')).toHaveLength(1);
    expect(valueOf(r, 'png.text-author')).toBe('Example Person');
    expect(r.copyRefusal).toBeNull(); // a damaged ancillary chunk does not block a copy
  });

  it('reports data after IEND and keeps it removable', async () => {
    const t = byCode(await analyseFixture('png-trailing.png'), 'png.trailing-data')[0]!;
    expect(t).toMatchObject({ status: 'suspicious', group: 'trailer' });
    expect(t.value).toContain('begins like a ZIP archive');
  });

  it.each([
    ['png-truncated.png', 'png.truncated'],
    ['png-bad-length.png', 'png.truncated'],
  ])('%s is unsound and flagged %s', async (file, code) => {
    const r = await analyseFixture(file);
    expect(r.structurallyUnsound).toBe(true);
    expect(byCode(r, code)).toHaveLength(1);
    expect(r.copyRefusal).not.toBeNull();
  });

  it('flags order violations and duplicates', async () => {
    const r = await analyseFixture('png-out-of-order.png');
    const issues = byCode(r, 'png.order').map((f) => f.value);
    expect(issues.join(' ')).toMatch(/pHYs chunk appears more than once/);
    expect(issues.join(' ')).toMatch(/IDAT chunks are not consecutive/);
    expect(r.structurallyUnsound).toBe(true);
  });

  it('refuses extreme dimensions without allocating', async () => {
    const r = await analyseFixture('png-extreme-dimensions.png');
    expect(r.dimensions).toEqual({ width: 2147483647, height: 2147483647 });
    expect(r.copyRefusal).toMatch(/larger than this tool will decode/);
  });

  it('keeps hostile text as plain text', async () => {
    const r = await analyseFixture('png-hostile-metadata.png');
    expect(byCode(r, 'png.text')[0]!.value).toBe('<img src=x onerror=alert(1)><script>alert(2)</script>');
    for (const f of r.findings) expect(f.value ?? '').not.toMatch(/[‪-‮⁦-⁩\u0001]/);
  });
});

describe('PNG decompression bounds', () => {
  it('caps a 20 MiB zTXt expansion and reports it as suspicious', async () => {
    const bytes = fixture('png-zbomb.png');
    expect(bytes.length).toBeLessThan(40_000);
    const r = await analyseFixture('png-zbomb.png');
    const f = byCode(r, 'png.text')[0]!;
    expect(f.status).toBe('suspicious');
    expect(f.limitations.join(' ')).toMatch(/decompression bomb/);
    expect((f.value ?? '').length).toBeLessThanOrEqual(500);
  });

  it('inflateBounded never returns more than max', async () => {
    const res = await inflateBounded(Uint8Array.from(deflateSync(new Uint8Array(5_000_000))), 1000);
    expect(res.truncated).toBe(true);
    expect(res.bytes.length).toBe(1000);
  });

  it('inflateBounded reports invalid streams without throwing', async () => {
    const res = await inflateBounded(Uint8Array.of(1, 2, 3, 4, 5), 1000);
    expect(res.error).toBe(true);
  });

  it('stops spending the total budget across many compressed chunks', async () => {
    const big = cat(latin('K\0\0'), Uint8Array.from(deflateSync(new Uint8Array(250_000))));
    const before = Array.from({ length: 12 }, () => chunk('zTXt', big));
    const r = await analysePng(buildPng({ before }));
    expect(r.findings.some((f) => f.code === 'png.limit')).toBe(true);
  });
});

describe('PNG structure and policy table', () => {
  it('verifies CRCs with an implementation independent of the one under test', () => {
    const scan = scanPng(fixture('png-clean.png'));
    expect(scan.chunks.every((c) => c.crcOk)).toBe(true);
    expect(scan.chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('rejects a bad signature, invalid chunk names and oversized lengths', () => {
    expect(scanPng(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9)).invalid).toMatch(/signature/);
    const badName = cat(PNG_SIG, Uint8Array.of(0, 0, 0, 0, 0x31, 0x32, 0x33, 0x34, 0, 0, 0, 0));
    expect(scanPng(badName).invalid).toMatch(/type code/);
    const huge = cat(PNG_SIG, Uint8Array.of(0xff, 0xff, 0xff, 0xff), latin('IHDR'), new Uint8Array(20));
    expect(scanPng(huge).invalid).toMatch(/length/);
  });

  it('classifies chunks: critical and display chunks are always kept, metadata is removable, unknown is opt-in', () => {
    for (const t of ['IHDR', 'PLTE', 'IDAT', 'IEND']) expect(classifyChunk(t)).toMatchObject({ kind: 'critical', alwaysKeep: true });
    for (const t of ['iCCP', 'sRGB', 'gAMA', 'cHRM', 'cICP', 'pHYs', 'tRNS', 'bKGD', 'acTL', 'fcTL', 'fdAT']) expect(classifyChunk(t).alwaysKeep).toBe(true);
    expect(classifyChunk('tEXt').group).toBe('png-text');
    expect(classifyChunk('iTXt').group).toBe('png-text');
    expect(classifyChunk('eXIf').group).toBe('png-exif');
    expect(classifyChunk('tIME').group).toBe('png-time');
    expect(classifyChunk('zzZz')).toMatchObject({ kind: 'unknown-ancillary', group: 'png-unknown' });
    expect(classifyChunk('ZZZZ')).toMatchObject({ kind: 'unknown-critical', alwaysKeep: true });
  });

  it('treats an unknown critical chunk as a reason to refuse a copy', async () => {
    const png = cat(PNG_SIG, ihdr(64, 48), chunk('QQQQ', Uint8Array.of(1)), idatFor(64, 48), iend());
    const r = await analysePng(png);
    expect(r.copyRefusal).not.toBeNull();
  });

  it('stops at the chunk limit', async () => {
    const many = Array.from({ length: 21_000 }, () => chunk('zzZz', new Uint8Array(0)));
    const r = await analysePng(buildPng({ before: many }));
    expect(r.findings.some((f) => f.code === 'png.limit')).toBe(true);
    expect(r.copyRefusal).not.toBeNull();
  });

  it('marks an animated PNG as preserved structure', async () => {
    const actl = chunk('acTL', cat(Uint8Array.of(0, 0, 0, 3), Uint8Array.of(0, 0, 0, 0)));
    const r = await analysePng(buildPng({ before: [actl] }));
    expect(byCode({ findings: r.findings } as never, 'png.apng')[0]).toMatchObject({ transformation: 'preserved', value: '3 frames declared' });
  });
});
