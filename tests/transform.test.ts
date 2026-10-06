import { describe, expect, it } from 'vitest';
import jpegjs from 'jpeg-js';
import { createCopy, verifyCopy, type DecodeCompare } from '../src/transform/verify';
import { removalGroupsFor } from '../src/transform/groups';
import { orientationOnlyExifSegment } from '../src/transform/jpeg';
import { orientationOnlyExifChunk } from '../src/transform/png';
import { analyseJpeg } from '../src/formats/jpeg';
import { analysePng } from '../src/formats/png';
import { sha256Hex } from '../src/core/analyze';
import { RefusedError } from '../src/core/errors';
import { analyseFixture, byCode, fixture } from './helpers';
import { cat } from '../fixtures/lib/jpeg';

/** Node stand-in for the browser decoder: jpeg-js for JPEG, byte-identical image data for PNG. */
const nodeDecode: DecodeCompare = async (a, b, format) => {
  if (format !== 'jpeg') return { dimensionsEqual: null, pixelsIdentical: null, detail: 'skipped in node', failed: false };
  const da = jpegjs.decode(a, { useTArray: true });
  const db = jpegjs.decode(b, { useTArray: true });
  const same = da.width === db.width && da.height === db.height && Buffer.from(da.data).equals(Buffer.from(db.data));
  return { dimensionsEqual: da.width === db.width && da.height === db.height, pixelsIdentical: same, detail: 'jpeg-js', failed: false };
};

const defaultGroups = async (file: string) => {
  const r = await analyseFixture(file);
  return { r, groups: removalGroupsFor(r).filter((g) => g.defaultOn).map((g) => g.id), all: removalGroupsFor(r).map((g) => g.id) };
};

describe('JPEG copy', () => {
  it('removes default metadata groups, keeps orientation, colour profile and unknown structures, and verifies', async () => {
    const original = fixture('jpeg-kitchen-sink.jpg');
    const snapshot = Uint8Array.from(original);
    const { r, groups } = await defaultGroups('jpeg-kitchen-sink.jpg');
    expect(groups.sort()).toEqual(['comments', 'exif', 'iptc', 'xmp']);
    const res = await createCopy(original, r, groups, nodeDecode);

    expect(Buffer.from(original).equals(Buffer.from(snapshot))).toBe(true); // input never mutated
    expect(res.verification.allPassed).toBe(true);
    expect(res.verification.checks.map((c) => `${c.id}:${c.status}`)).toEqual([
      'format:pass', 'selected-removed:pass', 'nothing-new:pass', 'kept-as-planned:pass', 'picture-data:pass', 'dimensions:pass', 'orientation:pass', 'original-untouched:pass', 'decode:pass',
    ]);
    expect(res.verification.pixelsIdentical).toBe(true);

    const copy = analyseJpeg(res.output);
    const codes = new Set(copy.findings.map((f) => f.code));
    for (const gone of ['exif.gps-position', 'exif.make', 'exif.serial', 'exif.thumbnail', 'xmp.creator', 'iptc.byline', 'jpeg.comment']) expect(codes.has(gone)).toBe(false);
    for (const kept of ['exif.orientation', 'icc.profile', 'jpeg.app-unknown', 'jpeg.mpf', 'jpeg.trailing-data', 'jpeg.jfif']) expect(codes.has(kept)).toBe(true);
    expect(copy.orientation).toBe(6);
    expect(copy.dimensions).toEqual({ width: 64, height: 48 });
    expect(res.output.length).toBeLessThan(original.length);
  });

  it('removes opt-in groups only when selected, ending exactly at EOI', async () => {
    const original = fixture('jpeg-kitchen-sink.jpg');
    const { r, all } = await defaultGroups('jpeg-kitchen-sink.jpg');
    const res = await createCopy(original, r, all, nodeDecode);
    expect(res.verification.allPassed).toBe(true);
    const copy = analyseJpeg(res.output);
    expect(copy.findings.map((f) => f.code).sort()).toEqual(['exif.orientation', 'icc.profile', 'image.dimensions', 'jpeg.jfif']);
    expect(res.output.at(-2)).toBe(0xff);
    expect(res.output.at(-1)).toBe(0xd9);
  });

  it('produces an orientation-only EXIF segment that parses back to the same value', () => {
    for (const o of [2, 3, 6, 8]) {
      const seg = orientationOnlyExifSegment(o);
      const jpeg = cat(Uint8Array.of(0xff, 0xd8), seg, Uint8Array.of(0xff, 0xd9));
      const a = analyseJpeg(jpeg);
      expect(a.orientation).toBe(o);
      expect(a.findings.filter((f) => f.code.startsWith('exif.')).map((f) => f.code)).toEqual(['exif.orientation']);
    }
  });

  it('is deterministic and the manifest accounts for every removed byte', async () => {
    const original = fixture('jpeg-kitchen-sink.jpg');
    const { r, groups } = await defaultGroups('jpeg-kitchen-sink.jpg');
    const a = await createCopy(original, r, groups);
    const b = await createCopy(original, r, groups);
    expect(Buffer.from(a.output).equals(Buffer.from(b.output))).toBe(true);
    expect(a.manifest).toEqual(b.manifest);
    expect(a.manifest.outputBytes).toBe(a.output.length);
    expect(a.manifest.inputBytes).toBe(original.length);
    const removed = a.manifest.entries.filter((e) => e.action === 'removed').reduce((s, e) => s + e.bytes, 0);
    const rewritten = a.manifest.entries.filter((e) => e.action === 'rewritten').reduce((s, e) => s + e.bytes, 0);
    const rewrittenOriginals = a.manifest.entries
      .filter((e) => e.action === 'rewritten')
      .reduce((s, e) => s + Number(/Original segment: (\d+) bytes/.exec(e.note ?? '')![1]), 0);
    expect(original.length - removed - rewrittenOriginals + rewritten).toBe(a.output.length);
    expect(a.manifest.preservedPolicy.length).toBeGreaterThan(0);
    expect(a.manifest.mayChange.join(' ')).toMatch(/not re-encoded/);
  });

  it('works for every JPEG fixture that is not refused, with all groups selected', async () => {
    const files = ['jpeg-exif.jpg', 'jpeg-exif-le.jpg', 'jpeg-gps.jpg', 'jpeg-orientation6.jpg', 'jpeg-thumbnail.jpg', 'jpeg-xmp.jpg', 'jpeg-comment.jpg', 'jpeg-icc.jpg', 'jpeg-iptc.jpg', 'jpeg-trailing.jpg', 'jpeg-duplicate-segments.jpg', 'jpeg-hostile-metadata.jpg', 'jpeg-fake-extension.png'];
    for (const f of files) {
      const { r, all } = await defaultGroups(f);
      if (all.length === 0) continue;
      const res = await createCopy(fixture(f), r, all, nodeDecode);
      expect(res.verification.allPassed, f).toBe(true);
      expect(res.verification.pixelsIdentical, f).toBe(true);
    }
  });

  it('refuses damaged, extreme and empty-selection inputs with a structured refusal', async () => {
    for (const f of ['jpeg-truncated.jpg', 'jpeg-invalid-length.jpg', 'jpeg-tiny-length.jpg', 'jpeg-extreme-dimensions.jpg']) {
      const r = await analyseFixture(f);
      await expect(createCopy(fixture(f), r, ['exif'])).rejects.toBeInstanceOf(RefusedError);
    }
    const r = await analyseFixture('jpeg-exif.jpg');
    await expect(createCopy(fixture('jpeg-exif.jpg'), r, [])).rejects.toBeInstanceOf(RefusedError);
  });
});

describe('PNG copy', () => {
  it('removes text, XMP, EXIF and time; keeps ICC, pHYs, unknown chunks and trailing data by default', async () => {
    const original = fixture('png-kitchen-sink.png');
    const { r, groups } = await defaultGroups('png-kitchen-sink.png');
    expect(groups.sort()).toEqual(['png-exif', 'png-text', 'png-time']);
    const res = await createCopy(original, r, groups, nodeDecode);
    expect(res.verification.allPassed).toBe(true);
    const copy = await analysePng(res.output);
    const codes = new Set(copy.findings.map((f) => f.code));
    for (const gone of ['png.text', 'png.text-author', 'xmp.creator', 'exif.gps-position', 'png.time']) expect(codes.has(gone)).toBe(false);
    for (const kept of ['icc.profile', 'png.phys', 'png.unknown-chunk', 'png.trailing-data']) expect(codes.has(kept)).toBe(true);
  });

  it('removes opt-in groups when selected and ends at IEND', async () => {
    const { r, all } = await defaultGroups('png-kitchen-sink.png');
    const res = await createCopy(fixture('png-kitchen-sink.png'), r, all);
    expect(res.verification.allPassed).toBe(true);
    const copy = await analysePng(res.output);
    expect(copy.findings.map((f) => f.code).sort()).toEqual(['icc.profile', 'image.dimensions', 'png.phys']);
    expect(Buffer.from(res.output.subarray(-12)).toString('latin1')).toContain('IEND');
  });

  it('keeps an eXIf chunk that holds only orientation', async () => {
    const chunk = orientationOnlyExifChunk(6);
    const base = fixture('png-clean.png');
    // eXIf must precede IDAT per the specification: place it right after IHDR (8 + 25 bytes).
    const withExif = cat(base.subarray(0, 33), chunk, base.subarray(33));
    const r0 = await analysePng(withExif);
    expect(r0.orientation).toBe(6);
    const report = await analyseFixtureBytes(withExif);
    const res = await createCopy(withExif, report, ['png-exif']);
    const copy = await analysePng(res.output);
    expect(copy.orientation).toBe(6);
    expect(copy.findings.filter((f) => f.code.startsWith('exif.')).map((f) => f.code)).toEqual(['exif.orientation']);
    expect(res.verification.allPassed).toBe(true);
  });

  it('refuses structurally unsound PNGs', async () => {
    for (const f of ['png-truncated.png', 'png-bad-length.png', 'png-out-of-order.png', 'png-extreme-dimensions.png']) {
      const r = await analyseFixture(f);
      await expect(createCopy(fixture(f), r, ['png-text'])).rejects.toBeInstanceOf(RefusedError);
    }
  });

  it('works on every other PNG fixture with all groups selected', async () => {
    for (const f of ['png-text.png', 'png-ztxt.png', 'png-itxt.png', 'png-exif.png', 'png-time.png', 'png-xmp.png', 'png-unknown-chunk.png', 'png-bad-crc.png', 'png-trailing.png', 'png-hostile-metadata.png', 'png-fake-extension.jpg']) {
      const { r, all } = await defaultGroups(f);
      if (all.length === 0) continue;
      const res = await createCopy(fixture(f), r, all);
      expect(res.verification.allPassed, f).toBe(true);
    }
  });

  it('removes a text chunk that had a bad checksum and keeps picture data identical', async () => {
    const { r, all } = await defaultGroups('png-bad-crc.png');
    const res = await createCopy(fixture('png-bad-crc.png'), r, all);
    const copy = await analysePng(res.output);
    expect(copy.findings.some((f) => f.code === 'png.crc-invalid')).toBe(false);
    expect(res.verification.checks.find((c) => c.id === 'picture-data')!.status).toBe('pass');
  });
});

async function analyseFixtureBytes(bytes: Uint8Array) {
  const { analyseBytes } = await import('../src/core/analyze');
  const out = await analyseBytes(bytes, { name: 'x.png', type: 'image/png' });
  if (!out.supported) throw new Error('unsupported');
  return out.report;
}

describe('verification catches bad copies', () => {
  it('fails when a selected finding is still present', async () => {
    const original = fixture('jpeg-gps.jpg');
    const r = await analyseFixture('jpeg-gps.jpg');
    const v = await verifyCopy(original, await sha256Hex(original), r, original, ['exif']);
    expect(v.allPassed).toBe(false);
    expect(v.checks.find((c) => c.id === 'selected-removed')!.status).toBe('fail');
  });

  it('fails when picture data differs', async () => {
    const original = fixture('png-text.png');
    const r = await analyseFixture('png-text.png');
    const { r: rr } = await defaultGroups('png-text.png');
    const res = await createCopy(original, rr, ['png-text']);
    const tampered = Uint8Array.from(res.output);
    // Flip a byte inside IDAT data and fix nothing else: CRC mismatch also makes the copy unsound.
    tampered[60] ^= 0xff;
    const v = await verifyCopy(original, await sha256Hex(original), r, tampered, ['png-text']);
    expect(v.allPassed).toBe(false);
    expect(v.checks.find((c) => c.id === 'picture-data')!.status).toBe('fail');
  });

  it('fails when the original in memory changed during the job', async () => {
    const original = Uint8Array.from(fixture('jpeg-exif.jpg'));
    const r = await analyseFixture('jpeg-exif.jpg');
    const res = await createCopy(original, r, ['exif']);
    const staleHash = await sha256Hex(fixture('jpeg-gps.jpg'));
    const v = await verifyCopy(original, staleHash, r, res.output, ['exif']);
    expect(v.checks.find((c) => c.id === 'original-untouched')!.status).toBe('fail');
  });

  it('reports a decode failure as a failed check', async () => {
    const original = fixture('jpeg-exif.jpg');
    const r = await analyseFixture('jpeg-exif.jpg');
    const res = await createCopy(original, r, ['exif'], async () => ({ dimensionsEqual: null, pixelsIdentical: null, detail: 'boom', failed: true }));
    expect(res.verification.allPassed).toBe(false);
  });

  it('refuses PDF copies', async () => {
    const r = await analyseFixture('pdf-basic.pdf');
    await expect(createCopy(fixture('pdf-basic.pdf'), r, ['x'])).rejects.toBeInstanceOf(RefusedError);
    expect(removalGroupsFor(r)).toEqual([]);
  });
});

describe('removal groups', () => {
  it('offers only groups that exist in the file, with unknown structures off by default', async () => {
    const g = removalGroupsFor(await analyseFixture('jpeg-kitchen-sink.jpg'));
    expect(g.map((x) => [x.id, x.defaultOn])).toEqual([['exif', true], ['xmp', true], ['iptc', true], ['comments', true], ['other-segments', false], ['trailer', false]]);
    expect(removalGroupsFor(await analyseFixture('jpeg-clean.jpg'))).toEqual([]);
    expect(removalGroupsFor(await analyseFixture('jpeg-truncated.jpg'))).toEqual([]);
    expect(byCode(await analyseFixture('jpeg-orientation6.jpg'), 'exif.orientation')).toHaveLength(1);
    expect(removalGroupsFor(await analyseFixture('jpeg-orientation6.jpg'))).toEqual([]);
  });
});
