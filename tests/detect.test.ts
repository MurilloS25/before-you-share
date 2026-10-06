import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildFingerprint, detectFormat, extensionOf } from '../src/core/detect';
import { analyseBytes, sha256Hex } from '../src/core/analyze';
import { fixture, outcomeOf } from './helpers';
import { latin } from '../fixtures/lib/jpeg';

describe('format detection from content', () => {
  it.each([
    ['jpeg-clean.jpg', 'jpeg'],
    ['png-clean.png', 'png'],
    ['pdf-basic.pdf', 'pdf'],
    ['jpeg-fake-extension.png', 'jpeg'],
    ['png-fake-extension.jpg', 'png'],
    ['pdf-fake-extension.jpg', 'pdf'],
  ])('%s is detected as %s regardless of name', (file, fmt) => {
    expect(detectFormat(fixture(file).subarray(0, 1032)).format).toBe(fmt);
  });

  it('finds %PDF- up to 1024 bytes into the file but not beyond', () => {
    const pad = (n: number) => Uint8Array.from([...new Uint8Array(n).fill(0x20), ...latin('%PDF-1.7\n')]);
    expect(detectFormat(pad(1000).subarray(0, 1032)).format).toBe('pdf');
    expect(detectFormat(pad(1100).subarray(0, 1032)).format).toBeNull();
  });

  it('recognises other formats as unsupported rather than guessing', () => {
    const gif = detectFormat(fixture('unsupported.gif'));
    expect(gif).toMatchObject({ format: null, recognisedUnsupported: true });
    expect(detectFormat(Uint8Array.of(0x50, 0x4b, 3, 4)).label).toMatch(/ZIP/);
    expect(detectFormat(fixture('unsupported.txt'))).toMatchObject({ format: null, recognisedUnsupported: false });
  });

  it('handles empty and tiny inputs', () => {
    expect(detectFormat(new Uint8Array(0)).format).toBeNull();
    expect(detectFormat(Uint8Array.of(0xff)).format).toBeNull();
    expect(detectFormat(Uint8Array.of(0xff, 0xd8)).format).toBeNull();
    expect(detectFormat(Uint8Array.of(0x89, 0x50, 0x4e)).format).toBeNull();
  });

  it('does not treat a lying MIME type or extension as evidence', async () => {
    const out = await analyseBytes(fixture('unsupported.txt'), { name: 'photo.jpg', type: 'image/jpeg' });
    expect(out.supported).toBe(false);
    if (!out.supported) {
      expect(out.fingerprint.detectedFormat).toBeNull();
      expect(out.fingerprint.extensionCheck).toBe('unknown');
    }
  });
});

describe('extension and declared type comparison', () => {
  it('extracts extensions conservatively', () => {
    expect(extensionOf('a.b.JPG')).toBe('jpg');
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('.hidden')).toBe('');
    expect(extensionOf('C:\\dir.d\\file')).toBe('');
    expect(extensionOf('trailingdot.')).toBe('');
  });

  it('reports a mismatch finding for a wrong extension and a wrong declared type', async () => {
    const out = await outcomeOf('jpeg-fake-extension.png', 'image/png');
    expect(out.supported).toBe(true);
    if (out.supported) {
      expect(out.report.fingerprint).toMatchObject({ extensionCheck: 'mismatch', declaredTypeCheck: 'mismatch', detectedType: 'image/jpeg' });
      const f = out.report.findings.find((x) => x.code === 'file.type-mismatch')!;
      expect(f.status).toBe('verified');
      expect(f.value).toContain('.png');
    }
  });

  it('does not report a mismatch when they agree, and accepts jpeg aliases', async () => {
    const out = await analyseBytes(fixture('jpeg-clean.jpg'), { name: 'x.JPEG', type: 'image/jpeg' });
    if (!out.supported) throw new Error('x');
    expect(out.report.findings.some((f) => f.code === 'file.type-mismatch')).toBe(false);
    expect(buildFingerprint(1, 'a.jpe', 'image/jpeg', detectFormat(fixture('jpeg-clean.jpg')), null).extensionCheck).toBe('match');
  });

  it('computes a SHA-256 that identifies bytes and matches an independent implementation', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const out = await outcomeOf('jpeg-clean.jpg');
    if (!out.supported) throw new Error('unsupported');
    expect(out.report.fingerprint.sha256).toBe(createHash('sha256').update(fixture('jpeg-clean.jpg')).digest('hex'));
  });
});
