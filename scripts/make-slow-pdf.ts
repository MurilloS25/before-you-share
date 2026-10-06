import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Writes a synthetic ~60 MiB "PDF" made of repeated page objects and no cross-reference table. A PDF reader must
 * rebuild the table by scanning it, which takes seconds, so it is a legitimate file for trying the Cancel button.
 * Usage: npx tsx scripts/make-slow-pdf.ts <output path> [MiB]
 */
const out = resolve(process.argv[2] ?? 'slow-example.pdf');
const mib = Number(process.argv[3] ?? 60);
const unit = '1 0 obj\n<< /Type /Page /Parent 2 0 R /Contents [3 0 R 4 0 R] >>\nendobj\n';
const body = unit.repeat(Math.floor((mib * 1024 * 1024) / unit.length));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `%PDF-1.7\n${body}`);
console.log(`wrote ${out} (${Math.round((body.length + 9) / 1048576)} MiB, synthetic)`);
