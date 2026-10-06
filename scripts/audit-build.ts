import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Inspects the production build for network endpoints, forbidden APIs in first-party code, inline
 * code, and bundle budgets. Run with `npm run audit:build` after `npm run build`.
 *
 * It cannot prove the absence of network access (the CSP and the browser tests do that); it makes
 * every URL and network-capable API in the output visible and fails on anything unexpected.
 */

export interface AuditResult {
  ok: boolean;
  failures: string[];
  notes: string[];
  sizes: Array<{ file: string; bytes: number; gzip: number }>;
}

/** URLs that appear in the bundle as identifiers, XML namespaces or library comments, not as endpoints. Each needs a reason. */
const ALLOWED_URL = [
  { re: /^https?:\/\/www\.w3\.org\//, why: 'XML/HTML/SVG namespace identifiers' },
  { re: /^https?:\/\/ns\.adobe\.com\//, why: 'XMP and XFDF namespace identifiers' },
  { re: /^https?:\/\/www\.xfa\.org\//, why: 'XFA namespace identifiers (XFA is disabled)' },
  { re: /^https:\/\/github\.com\/zloirock\/core-js/, why: 'core-js licence/comment text' },
  { re: /^https?:\/\/\$\{/, why: 'template literal, not a fixed endpoint' },
  { re: /^https?:\/\/(example\.com|foo\.bar|a|x|a@b|a#б|тест)(\/|$|\?)/, why: 'pdf.js URL-parser test fixtures embedded in its bundle' },
  { re: /^https:\/\/a\//, why: 'pdf.js URL-parser test fixtures embedded in its bundle' },
];

/** Network-capable APIs. In first-party chunks these must not appear at all. */
const NETWORK_APIS = [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bsendBeacon\b/, /\bEventSource\b/, /\bimportScripts\b/];

export function auditBuild(dist = 'dist'): AuditResult {
  const failures: string[] = [];
  const notes: string[] = [];
  const sizes: AuditResult['sizes'] = [];
  const assets = join(dist, 'assets');
  const html = readFileSync(join(dist, 'index.html'), 'utf8');

  if (!/http-equiv="Content-Security-Policy"/.test(html)) failures.push('index.html has no CSP meta tag');
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) failures.push('index.html contains an inline script');
  if (/\sstyle=|<style/i.test(html)) failures.push('index.html contains inline style');
  if (/(?:src|href)=["']https?:/i.test(html)) failures.push('index.html references an absolute http(s) URL');
  if (/\son\w+=/i.test(html)) failures.push('index.html contains an inline event handler');

  const files = readdirSync(assets);
  for (const f of files) {
    const p = join(assets, f);
    const buf = readFileSync(p);
    sizes.push({ file: f, bytes: statSync(p).size, gzip: gzipSync(buf).length });
    if (f.endsWith('.map')) failures.push(`source map shipped: ${f}`);
    if (!/\.(js|css)$/.test(f)) continue;
    const text = buf.toString('utf8');
    const isLibrary = /^(pdf|pdf\.worker)-/.test(f) && statSync(p).size > 100_000; // our own pdf.ts chunk is small and held to the first-party rules
    for (const m of text.matchAll(/(?:https?|wss?|ftp):\/\/[^\s"'`)<>\\,;]+/g)) {
      const url = m[0];
      if (!ALLOWED_URL.some((a) => a.re.test(url))) failures.push(`unexpected URL in ${f}: ${url.slice(0, 80)}`);
    }
    if (/\bdata:(?!image\/svg)/.test(text) && /^index-.*\.css$/.test(f)) failures.push(`data: URL in ${f}`);
    for (const re of NETWORK_APIS) {
      if (re.test(text)) {
        if (isLibrary) notes.push(`${f}: contains ${re.source} (pdf.js loader code; unreachable for in-memory data and blocked by connect-src 'none')`);
        else failures.push(`${f}: first-party chunk uses ${re.source}`);
      }
    }
    if (!isLibrary && /\beval\s*\(|new Function\s*\(/.test(text)) failures.push(`${f}: eval or new Function in first-party chunk`);
  }

  // PDF tooling must be lazy and worker-only.
  const entry = files.find((f) => /^index-.*\.js$/.test(f));
  if (!entry) failures.push('entry chunk not found');
  else {
    const t = readFileSync(join(assets, entry), 'utf8');
    if (/pdfjs|PasswordException|WorkerMessageHandler/.test(t)) failures.push('PDF tooling leaked into the entry chunk');
    if (/pdf-[\w-]+\.js|pdf\.worker/.test(t)) failures.push('entry chunk references PDF chunks');
    const gz = sizes.find((s) => s.file === entry)!.gzip;
    if (gz > 30_000) failures.push(`entry chunk is ${gz} bytes gzipped (budget 30000)`);
    notes.push(`entry chunk ${gz} bytes gzipped`);
  }
  const worker = sizes.find((s) => /^analysis\.worker-/.test(s.file));
  if (!worker) failures.push('analysis worker chunk not found');
  else if (worker.gzip > 40_000) failures.push(`analysis worker is ${worker.gzip} bytes gzipped (budget 40000)`);
  const wtext = worker ? readFileSync(join(assets, worker.file), 'utf8') : '';
  if (/WorkerMessageHandler|PasswordException/.test(wtext)) failures.push('PDF library is bundled into the worker entry instead of loaded lazily');

  return { ok: failures.length === 0, failures, notes, sizes };
}

if (process.argv[1] && /audit-build\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
  const r = auditBuild();
  for (const s of r.sizes.sort((a, b) => b.bytes - a.bytes)) console.log(`${String(s.bytes).padStart(9)} ${String(s.gzip).padStart(8)} gz  ${s.file}`);
  for (const n of r.notes) console.log(`note: ${n}`);
  for (const f of r.failures) console.error(`FAIL: ${f}`);
  console.log(r.ok ? 'build audit: OK' : 'build audit: FAILED');
  process.exit(r.ok ? 0 : 1);
}
