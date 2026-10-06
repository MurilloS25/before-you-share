import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { baseJpeg, cat, commentSegment, insertSegments } from '../fixtures/lib/jpeg';

/**
 * Writes a small synthetic JPEG with 700 comment segments, so the parser reaches its 600-finding cap and the
 * results screen shows "Showing 10 of 599 findings" with a Show more control.
 * Usage: npx tsx scripts/make-many-findings.ts <output path> [count]
 */
const out = resolve(process.argv[2] ?? 'many-findings.jpg');
const n = Number(process.argv[3] ?? 700);
const jpeg = insertSegments(baseJpeg(), Array.from({ length: n }, (_, i) => commentSegment(`synthetic comment ${i}`)));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, cat(jpeg));
console.log(`wrote ${out} (${jpeg.length} bytes, ${n} synthetic comments)`);
