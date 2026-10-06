import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/core/explain';

/** Wording guard: docs/CLAIMS.md lists what the product must not say. Disclaimers may use the words to deny them. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const files = walk('src').filter((f) => !f.endsWith('.d.ts') && !f.split(/[\\/]/).includes('types'));

const BANNED: Array<[string, RegExp]> = [
  ['safe file', /\bsafe file\b/i],
  ['fully clean', /fully clean|completely clean|\bclean copy\b/i],
  ['all metadata removed', /all (the )?metadata (was |is |has been )?(removed|gone|deleted)/i],
  ['sanitized', /\bsanitiz(ed|ation)\b/i],
  ['malware-free', /malware[- ]free|virus[- ]free/i],
  ['risk score', /\brisk\b|privacy score|threat level/i],
  ['alarm words', /\b(leak(s|ed|ing)?|exposed|dangerous|danger)\b/i],
  ['secure', /\bsecure\b/i],
];
const ABSOLUTE: Array<[string, RegExp]> = [
  ['guarantee', /\bguarantee(d|s)?\b/i],
  ['anonymous', /\banonymous\b/i],
  ['certified', /\bcertified\b/i],
  ['protected', /\bprotected\b/i],
];
const DISCLAIMER = /\b(cannot|can't|not|never|no)\b[^.]{0,60}\b(guarantee|anonymous|certified|protected)|forensic|antivirus/i;

describe('product wording', () => {
  it('never uses banned claim phrases in source', () => {
    for (const f of files) {
      const text = strip(readFileSync(f, 'utf8'));
      for (const [name, re] of BANNED) expect(re.test(text), `${f}: ${name}`).toBe(false);
    }
  });

  it('uses absolute words only inside explicit disclaimers', () => {
    for (const f of files) {
      const lines = strip(readFileSync(f, 'utf8')).split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const [name, re] of ABSOLUTE) {
          if (re.test(line)) {
            const context = lines.slice(Math.max(0, i - 1), i + 2).join(' ');
            expect(DISCLAIMER.test(context), `${f}:${i + 1} ${name}: ${line.trim()}`).toBe(true);
          }
        }
      });
    }
  });

  it('explanations stay calm: every catalogue entry explains why in plain words and none uses alarm language', () => {
    for (const [code, e] of Object.entries(CATALOG)) {
      expect(e.privacy.length, code).toBeGreaterThan(30);
      expect(e.privacy, code).not.toMatch(/\b(danger|dangerous|leak|exposed|malicious|attack|hack|steal|threat)\b/i);
    }
  });
});
