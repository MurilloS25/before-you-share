import { describe, expect, it } from 'vitest';
import { analyseJpeg, scanJpeg, classifySegment } from '../src/formats/jpeg';
import { analyseFixture, byCode, fixture, valueOf } from './helpers';
import { baseJpeg, buildExif, exifSegment, insertSegments, segment } from '../fixtures/lib/jpeg';

describe('JPEG inspection', () => {
  it('reports a clean JPEG with only structural findings', async () => {
    const r = await analyseFixture('jpeg-clean.jpg');
    expect(r.dimensions).toEqual({ width: 64, height: 48 });
    expect(r.findings.map((f) => f.code).sort()).toEqual(['image.dimensions', 'jpeg.jfif']);
    expect(r.structurallyUnsound).toBe(false);
    expect(r.copyRefusal).toBeNull();
  });

  it('decodes EXIF device, software, dates, names, serial and lens with evidence locations', async () => {
    const r = await analyseFixture('jpeg-exif.jpg');
    expect(valueOf(r, 'exif.make')).toBe('Example Maker');
    expect(valueOf(r, 'exif.model')).toBe('Fixture Camera One');
    expect(valueOf(r, 'exif.software')).toBe('Fixture Editor 1.0');
    expect(valueOf(r, 'exif.datetime')).toBe('2000-01-02 03:04:05');
    expect(valueOf(r, 'exif.datetime-original')).toBe('2000-01-01 00:00:00');
    expect(valueOf(r, 'exif.artist')).toBe('Example Person');
    expect(valueOf(r, 'exif.serial')).toBe('FIXTURE-0000');
    expect(valueOf(r, 'exif.lens')).toBe('Fixture Lens 50mm');
    expect(valueOf(r, 'exif.user-comment')).toBe('Synthetic user comment');
    expect(valueOf(r, 'exif.xp-field')).toBe('Example Person');
    const make = byCode(r, 'exif.make')[0]!;
    expect(make).toMatchObject({ status: 'verified', confidence: 'high', category: 'device-software', removable: true, group: 'exif' });
    expect(make.location.kind).toBe('bytes');
    if (make.location.kind === 'bytes') {
      const bytes = fixture('jpeg-exif.jpg').subarray(make.location.offset, make.location.offset + make.location.length);
      expect(new TextDecoder().decode(bytes)).toContain('Example Maker');
    }
    const mn = byCode(r, 'exif.makernote')[0]!;
    expect(mn.status).toBe('unsupported');
    expect(mn.limitations.join(' ')).toMatch(/not decoded/);
  });

  it('reads little-endian and big-endian EXIF identically', async () => {
    const be = await analyseFixture('jpeg-exif.jpg');
    const le = await analyseFixture('jpeg-exif-le.jpg');
    const strip = (r: typeof be) => r.findings.map((f) => `${f.code}|${f.value}`);
    expect(strip(le)).toEqual(strip(be));
  });

  it('decodes GPS into a normalised position in the location category', async () => {
    const r = await analyseFixture('jpeg-gps.jpg');
    const gps = byCode(r, 'exif.gps-position')[0]!;
    expect(gps.value).toBe('0.250000° N, 0.750000° E');
    expect(gps.category).toBe('location');
    expect(gps.status).toBe('verified');
    expect(valueOf(r, 'exif.gps-altitude')).toBe('12.5 m');
    expect(valueOf(r, 'exif.gps-other')).toContain('2000:01:01');
  });

  it('flags GPS values that are out of range as suspicious', async () => {
    const jpeg = insertSegments(baseJpeg(), [exifSegment(buildExif({ gps: { lat: 95, lon: 10 } }))]);
    const r = analyseJpeg(jpeg);
    const gps = r.findings.find((f) => f.code === 'exif.gps-position')!;
    expect(gps.status).toBe('suspicious');
  });

  it('reads orientation and keeps it out of the privacy categories', async () => {
    const r = await analyseFixture('jpeg-orientation6.jpg');
    expect(r.orientation).toBe(6);
    const f = byCode(r, 'exif.orientation')[0]!;
    expect(f).toMatchObject({ category: 'structural', transformation: 'preserved', removable: false });
  });

  it('locates an embedded EXIF thumbnail and says it was not inspected', async () => {
    const r = await analyseFixture('jpeg-thumbnail.jpg');
    const t = byCode(r, 'exif.thumbnail')[0]!;
    expect(t.value).toMatch(/JPEG data/);
    expect(t.category).toBe('embedded-content');
    expect(t.limitations.join(' ')).toMatch(/not decoded or inspected/);
  });

  it('extracts well-known XMP properties as text', async () => {
    const r = await analyseFixture('jpeg-xmp.jpg');
    expect(valueOf(r, 'xmp.creator')).toBe('Example Person');
    expect(valueOf(r, 'xmp.tool')).toBe('Fixture Editor 1.0');
    expect(valueOf(r, 'xmp.title')).toBe('Fixture title & more');
    expect(valueOf(r, 'xmp.document-id')).toContain('xmp.did:');
    expect(valueOf(r, 'xmp.location')).toBe('Fixture City');
  });

  it('reads IPTC datasets and the Photoshop thumbnail resource', async () => {
    const r = await analyseFixture('jpeg-iptc.jpg');
    expect(valueOf(r, 'iptc.byline')).toBe('Example Person');
    expect(valueOf(r, 'iptc.caption')).toBe('Synthetic caption');
    expect(byCode(r, 'iptc.location').map((f) => f.value)).toEqual(['Fixture City', 'Fixtureland']);
    expect(byCode(r, 'photoshop.thumbnail')).toHaveLength(1);
  });

  it('reads comments and the ICC profile header', async () => {
    expect(valueOf(await analyseFixture('jpeg-comment.jpg'), 'jpeg.comment')).toBe('Synthetic comment by Example Person');
    const icc = byCode(await analyseFixture('jpeg-icc.jpg'), 'icc.profile')[0]!;
    expect(icc.value).toContain('Example Synthetic Profile');
    expect(icc.value).toContain('RGB display');
    expect(icc.transformation).toBe('preserved');
  });

  it('lists the kitchen sink: application segment, MPF and trailing data', async () => {
    const r = await analyseFixture('jpeg-kitchen-sink.jpg');
    expect(byCode(r, 'jpeg.app-unknown')[0]!.value).toContain('FixtureApp');
    expect(byCode(r, 'jpeg.mpf')[0]!.status).toBe('inferred');
    const trail = byCode(r, 'jpeg.trailing-data')[0]!;
    expect(trail.status).toBe('suspicious');
    expect(trail.value).toContain('23 bytes');
  });

  it('describes duplicate segments without silently dropping them', async () => {
    const r = await analyseFixture('jpeg-duplicate-segments.jpg');
    expect(byCode(r, 'jpeg.duplicate').length).toBeGreaterThanOrEqual(2);
    expect(byCode(r, 'jpeg.comment').map((f) => f.value)).toEqual(['first', 'second']);
    expect(byCode(r, 'xmp.packet')).toHaveLength(2);
  });

  it('keeps all values as plain text and neutralises control and bidi characters', async () => {
    const r = await analyseFixture('jpeg-hostile-metadata.jpg');
    expect(valueOf(r, 'exif.artist')).toBe('<img src=x onerror=alert(1)><script>alert(2)</script>');
    for (const f of r.findings) {
      expect(f.value ?? '').not.toMatch(/[‪-‮⁦-⁩\u0001\u0002]/);
    }
  });

  it.each([
    ['jpeg-truncated.jpg', 'jpeg.truncated'],
    ['jpeg-invalid-length.jpg', 'jpeg.truncated'],
    ['jpeg-tiny-length.jpg', 'jpeg.invalid-segment'],
  ])('flags %s as structurally unsound with %s', async (file, code) => {
    const r = await analyseFixture(file);
    expect(r.structurallyUnsound).toBe(true);
    expect(r.copyRefusal).not.toBeNull();
    expect(byCode(r, code)).toHaveLength(1);
  });

  it('refuses decode and copy for absurd declared dimensions without reading pixels', async () => {
    const r = await analyseFixture('jpeg-extreme-dimensions.jpg');
    expect(r.dimensions).toEqual({ width: 65535, height: 65535 });
    expect(byCode(r, 'image.extreme-dimensions')).toHaveLength(1);
    expect(r.copyRefusal).toMatch(/larger than this tool will decode/);
  });
});

describe('JPEG structure walking', () => {
  it('records each segment with offsets that point at real markers', () => {
    const bytes = fixture('jpeg-kitchen-sink.jpg');
    const scan = scanJpeg(bytes);
    expect(scan.eoiOffset).not.toBeNull();
    for (const s of scan.segments) {
      expect(bytes[s.offset]).toBe(0xff);
      expect(bytes[s.offset + 1]).toBe(s.marker);
      expect(s.offset + s.length).toBeLessThanOrEqual(bytes.length);
    }
    expect(scan.trailingStart).toBe(scan.eoiOffset! + 2);
  });

  it('classifies segments consistently with removal groups', () => {
    const bytes = fixture('jpeg-kitchen-sink.jpg');
    const kinds = scanJpeg(bytes).segments.map((s) => classifySegment(bytes, s).kind);
    expect(kinds).toEqual(expect.arrayContaining(['jfif', 'exif', 'xmp', 'icc', 'photoshop', 'comment', 'app-other', 'mpf']));
  });

  it('stops at the segment limit instead of walking unbounded input', () => {
    const many = Array.from({ length: 5000 }, () => segment(0xe5, Uint8Array.of(1)));
    const jpeg = insertSegments(baseJpeg(), many);
    const r = analyseJpeg(jpeg);
    expect(r.findings.some((f) => f.code === 'jpeg.limit')).toBe(true);
    expect(r.copyRefusal).not.toBeNull();
  });

  it('rejects non-JPEG input without throwing', () => {
    const r = analyseJpeg(Uint8Array.of(1, 2, 3, 4, 5));
    expect(r.structurallyUnsound).toBe(true);
  });
});
