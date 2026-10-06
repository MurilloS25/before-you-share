import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Static guard rails over first-party source: no network, storage, logging or HTML-injection APIs. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const files = walk('src').filter((f) => !f.endsWith('.d.ts'));
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FORBIDDEN: Array<[string, RegExp]> = [
  ['fetch', /\bfetch\s*\(/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['sendBeacon', /\bsendBeacon\b/],
  ['EventSource', /\bEventSource\b/],
  ['importScripts', /\bimportScripts\b/],
  ['localStorage', /\blocalStorage\b/],
  ['sessionStorage', /\bsessionStorage\b/],
  ['indexedDB', /\bindexedDB\b/],
  ['caches', /\bcaches\./],
  ['cookie', /document\.cookie/],
  ['serviceWorker', /\bserviceWorker\b/],
  ['console', /\bconsole\.(log|info|debug|warn|error|trace)\b/],
  ['innerHTML', /\b(inner|outer)HTML\b/],
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ['insertAdjacentHTML', /insertAdjacentHTML/],
  ['document.write', /document\.write/],
  ['eval', /\beval\s*\(/],
  ['new Function', /new Function\s*\(/],
  ['setTimeout with string', /setTimeout\s*\(\s*['"`]/],
  ['navigator.clipboard', /navigator\.clipboard/],
  ['FileSystemAccess', /showSaveFilePicker|showOpenFilePicker|showDirectoryPicker/],
  ['window.open', /window\.open\s*\(/],
  ['location assignment', /location\.(href|assign|replace)\s*=/],
  ['analytics or telemetry vendors', /\bgtag\(|google-analytics|googletagmanager|mixpanel|sentry|datadog|posthog|plausible|amplitude|@vercel\/(analytics|speed-insights)|hotjar/i],
];

describe('first-party source guard rails', () => {
  it('has source files to check', () => expect(files.length).toBeGreaterThan(20));
  for (const [name, re] of FORBIDDEN) {
    it(`never uses ${name}`, () => {
      const hits = files.filter((f) => re.test(strip(readFileSync(f, 'utf8'))));
      expect(hits).toEqual([]);
    });
  }

  it('only the PDF module and the preview module touch the PDF library, and only through dynamic import', () => {
    const importers = files.filter((f) => /from ['"]pdfjs-dist|import\(\s*['"]pdfjs-dist/.test(readFileSync(f, 'utf8')));
    expect(importers.map((f) => f.replace(/\\/g, '/')).sort()).toEqual(['src/formats/pdf.ts']);
    expect(readFileSync('src/formats/pdf.ts', 'utf8')).not.toMatch(/^import .* from 'pdfjs-dist/m);
  });

  it('loads PDF tooling lazily: no static import of the pdf module from the entry graph', () => {
    const analyze = readFileSync('src/core/analyze.ts', 'utf8');
    expect(analyze).toMatch(/await import\('\.\.\/formats\/pdf'\)/);
    expect(analyze).not.toMatch(/^import .* from '\.\.\/formats\/pdf'/m);
    expect(readFileSync('src/worker/analysis.worker.ts', 'utf8')).toMatch(/await import\('\.\/pdfPreview'\)/);
    for (const f of files.filter((x) => x.includes('src\\ui') || x.includes('src/ui') || x.endsWith('main.tsx'))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/formats\/pdf|pdfjs/);
    }
  });

  it('hardens pdf.js options', () => {
    const t = readFileSync('src/formats/pdf.ts', 'utf8');
    expect(t).toMatch(/isEvalSupported: false/);
    expect(t).toMatch(/useWorkerFetch: false/);
    expect(t).toMatch(/useSystemFonts: false/);
    expect(t).toMatch(/enableXfa: false/);
  });

  it('keeps file bytes out of messages other than the transferred output and preview bitmap', () => {
    const t = readFileSync('src/worker/protocol.ts', 'utf8');
    expect(t.match(/ArrayBuffer/g)?.length).toBe(2);
  });
});

describe('source hygiene', () => {
  it('contains no invisible or bidirectional control characters (Trojan Source)', () => {
    const all = [...walk('src'), ...walk('tests'), ...walk('e2e'), ...walk('scripts'), ...walk('fixtures/lib')];
    const bad: string[] = [];
    for (const f of all) {
      const text = readFileSync(f, 'utf8');
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        const invisible = (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0x061c || c === 0xfeff || (c < 0x20 && c !== 10 && c !== 13 && c !== 9);
        if (invisible) bad.push(`${f}:${text.slice(0, i).split('\n').length} U+${c.toString(16)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
