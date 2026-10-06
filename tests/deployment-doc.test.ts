import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from '../vite.config';

describe('deployment guide', () => {
  it('lists exactly the headers the preview server sends', () => {
    const md = readFileSync('docs/DEPLOYMENT.md', 'utf8');
    const block = /```json\n([\s\S]*?)\n```/.exec(md)![1]!;
    const config = JSON.parse(block) as { headers: Array<{ headers: Array<{ key: string; value: string }> }> };
    const documented = Object.fromEntries(config.headers[0]!.headers.map((h) => [h.key, h.value]));
    expect(documented).toEqual(SECURITY_HEADERS);
  });

  it('keeps the CSP restrictive', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy']!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-|wasm-unsafe-eval|\*|https?:/);
  });
});
