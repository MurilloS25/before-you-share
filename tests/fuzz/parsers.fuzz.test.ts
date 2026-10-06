import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { analyseBytes } from '../../src/core/analyze';
import { LIMITS } from '../../src/core/limits';
import { RefusedError } from '../../src/core/errors';
import { CATALOG } from '../../src/core/explain';
import { createCopy } from '../../src/transform/verify';
import { removalGroupsFor } from '../../src/transform/groups';
import { parseExif } from '../../src/formats/exif';
import { FindingSink } from '../../src/core/findings';
import type { AnalysisReport } from '../../src/core/types';
import { fixture } from '../helpers';
import { baseJpeg, cat, latin } from '../../fixtures/lib/jpeg';
import { chunk, buildPng, PNG_SIG } from '../../fixtures/lib/png';

/**
 * Property and mutation tests. These are NOT coverage-guided fuzzing: they throw bounded random and
 * structure-aware inputs at the parsers and assert invariants. The seed is fixed for reproducibility;
 * set FC_SEED to explore other inputs. A failing run prints the seed and counterexample.
 */
const SEED = Number(process.env.FC_SEED ?? 20261005);
const RUNS = Number(process.env.FC_RUNS ?? 300);
const params = { seed: SEED, numRuns: RUNS };

function checkReport(r: AnalysisReport, size: number): void {
  expect(r.findings.length).toBeLessThanOrEqual(LIMITS.maxFindings + 101);
  const ids = new Set<string>();
  for (const f of r.findings) {
    expect(ids.has(f.id)).toBe(false);
    ids.add(f.id);
    expect(f.code === 'limit.findings' || CATALOG[f.code] !== undefined).toBe(true);
    expect((f.value ?? '').length).toBeLessThanOrEqual(LIMITS.maxDisplayChars + 60);
    expect(f.removable).toBe(f.transformation === 'removable');
    if (f.location.kind === 'bytes') {
      expect(f.location.offset).toBeGreaterThanOrEqual(0);
      expect(f.location.length).toBeGreaterThanOrEqual(0);
      expect(f.location.offset + f.location.length).toBeLessThanOrEqual(size);
    }
  }
  expect(r.fingerprint.size).toBe(size);
}

async function run(bytes: Uint8Array, name = 'f.bin'): Promise<AnalysisReport | null> {
  const t0 = Date.now();
  const out = await analyseBytes(bytes, { name, type: '' });
  expect(Date.now() - t0).toBeLessThan(5000);
  if (!out.supported) return null;
  checkReport(out.report, bytes.length);
  return out.report;
}

const bytesArb = fc.uint8Array({ minLength: 0, maxLength: 3000 });

describe('random bytes never break the analysers', () => {
  it('arbitrary bytes', async () => {
    await fc.assert(
      fc.asyncProperty(bytesArb, async (b) => {
        await run(b);
      }),
      params,
    );
  });
  it.each([
    ['jpeg', Uint8Array.of(0xff, 0xd8, 0xff)],
    ['png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['pdf', latin('%PDF-1.7\n')],
    ['zip', Uint8Array.of(0x50, 0x4b, 3, 4)],
  ])('arbitrary bytes behind a %s signature', async (_n, sig) => {
    await fc.assert(
      fc.asyncProperty(bytesArb, async (b) => {
        await run(cat(sig, b));
      }),
      { ...params, numRuns: Math.min(RUNS, 150) },
    );
  });
});

const mutate = (src: Uint8Array) =>
  fc
    .tuple(
      fc.array(fc.tuple(fc.nat(src.length - 1), fc.integer({ min: 0, max: 255 })), { maxLength: 8 }),
      fc.option(fc.nat(src.length), { nil: undefined }),
    )
    .map(([flips, cut]) => {
      const b = Uint8Array.from(src);
      for (const [i, v] of flips) b[i] = v;
      return cut === undefined ? b : b.subarray(0, cut);
    });

describe('mutated fixtures (bit flips and truncation)', () => {
  const cases = ['jpeg-kitchen-sink.jpg', 'jpeg-iptc.jpg', 'jpeg-duplicate-segments.jpg', 'png-kitchen-sink.png', 'png-xmp.png', 'png-itxt.png', 'docx-comments-tracked.docx', 'docx-embedded.docx', 'docx-macro.docx'];
  it.each(cases)('%s analyses without throwing and bounds evidence', async (file) => {
    const src = fixture(file);
    await fc.assert(
      fc.asyncProperty(mutate(src), async (b) => {
        await run(b, file);
      }),
      params,
    );
  });

  it.each(['pdf-xmp.pdf', 'pdf-link-actions.pdf', 'pdf-form.pdf'])('%s (library-backed, fewer runs)', async (file) => {
    const src = fixture(file);
    await fc.assert(
      fc.asyncProperty(mutate(src), async (b) => {
        await run(b, file);
      }),
      { ...params, numRuns: Math.min(RUNS, 60) },
    );
  });
});

const jpegSegment = fc
  .tuple(fc.integer({ min: 0xe0, max: 0xfe }), fc.uint8Array({ maxLength: 120 }), fc.option(fc.integer({ min: 0, max: 0xffff }), { nil: undefined }))
  .map(([m, p, lenOverride]) => {
    const len = lenOverride ?? p.length + 2;
    return Uint8Array.of(0xff, m, len >> 8, len & 255, ...p);
  });

describe('structure-aware generation', () => {
  it('JPEG: random segment sequences with random declared lengths', async () => {
    const base = baseJpeg();
    await fc.assert(
      fc.asyncProperty(fc.array(jpegSegment, { maxLength: 12 }), async (segs) => {
        await run(cat(base.subarray(0, 2), ...segs, base.subarray(2)));
      }),
      params,
    );
  });

  it('PNG: random chunks with random types, lengths and CRCs', async () => {
    const chunkArb = fc
      .tuple(fc.stringMatching(/^[A-Za-z]{4}$/), fc.uint8Array({ maxLength: 80 }), fc.boolean(), fc.option(fc.integer({ min: 0, max: 0x7fffffff }), { nil: undefined }))
      .map(([t, d, bad, len]) => chunk(t, d, { badCrc: bad, lengthOverride: len }));
    await fc.assert(
      fc.asyncProperty(fc.array(chunkArb, { maxLength: 10 }), async (cs) => {
        await run(buildPng({ before: cs }));
      }),
      params,
    );
  });

  it('PNG: random metadata chunk payloads (keyword/NUL/flag layouts and compressed garbage)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('tEXt', 'zTXt', 'iTXt', 'iCCP', 'eXIf', 'tIME', 'pHYs', 'acTL'), fc.uint8Array({ maxLength: 200 }), async (t, d) => {
        await run(buildPng({ before: [chunk(t, d)] }));
      }),
      params,
    );
  });

  it('EXIF/TIFF: random IFD bytes behind a valid header never throw or loop', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.uint8Array({ maxLength: 400 }), (le, body) => {
        const header = le ? Uint8Array.of(0x49, 0x49, 42, 0, 8, 0, 0, 0) : Uint8Array.of(0x4d, 0x4d, 0, 42, 0, 0, 0, 8);
        const sink = new FindingSink();
        parseExif(cat(header, body), 100, sink, 'fuzz');
        for (const f of sink.findings) {
          if (f.location.kind === 'bytes') expect(f.location.offset + f.location.length).toBeLessThanOrEqual(100 + 8 + body.length);
        }
      }),
      { ...params, numRuns: RUNS * 3 },
    );
  });
});

describe('transformations on hostile input', () => {
  it('createCopy either refuses or produces a copy whose structural and picture checks pass', async () => {
    const files = ['jpeg-kitchen-sink.jpg', 'png-kitchen-sink.png', 'jpeg-iptc.jpg', 'png-xmp.png'];
    for (const file of files) {
      const src = fixture(file);
      await fc.assert(
        fc.asyncProperty(mutate(src), async (b) => {
          const out = await analyseBytes(b, { name: file, type: '' });
          if (!out.supported) return;
          const groups = removalGroupsFor(out.report).map((g) => g.id);
          if (groups.length === 0 || out.report.copyRefusal) return;
          try {
            const res = await createCopy(b, out.report, groups);
            for (const id of ['format', 'picture-data', 'dimensions', 'selected-removed', 'original-untouched']) {
              const c = res.verification.checks.find((x) => x.id === id)!;
              expect(c.status, `${file} ${id}: ${c.detail}`).not.toBe('fail');
            }
          } catch (e) {
            expect(e instanceof RefusedError, String(e)).toBe(true);
          }
        }),
        { ...params, numRuns: Math.min(RUNS, 200) },
      );
    }
  });
});

describe('sanity of the generators themselves', () => {
  it('the PNG signature constant matches the parser expectation', () => {
    expect(PNG_SIG.length).toBe(8);
  });
});
