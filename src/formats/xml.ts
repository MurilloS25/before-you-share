import { decodeEntities } from './xmp';

/**
 * Minimal, bounded XML helpers for inspecting Office packages. This is not an XML parser: it never builds a DOM,
 * resolves entities beyond the five predefined ones and numeric references, or follows anything. It only
 * tokenises start tags (quote-aware, any whitespace, both quote styles) after removing comments, processing
 * instructions and CDATA, and matches elements by local name so any namespace prefix works.
 */

const MAX_TAG = 4000;

/** Remove comments and processing instructions; turn CDATA into escaped text. Linear time. */
export function stripXmlNoise(xml: string): string {
  if (!xml.includes('<!') && !xml.includes('<?')) return xml;
  let out = '';
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      out += xml.slice(i);
      break;
    }
    out += xml.slice(i, lt);
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end === -1 ? xml.length : end + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      const body = xml.slice(lt + 9, end === -1 ? xml.length : end);
      out += body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      i = end === -1 ? xml.length : end + 3;
    } else if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      i = end === -1 ? xml.length : end + 2;
    } else if (xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt + 2);
      i = end === -1 ? xml.length : end + 1;
    } else {
      out += '<';
      i = lt + 1;
    }
  }
  return out;
}

export interface XmlTag {
  /** Qualified name as written, for example `w:ins`. */
  name: string;
  local: string;
  /** Attributes keyed by local name (prefix removed), decoded. */
  attrs: Map<string, string>;
  selfClosing: boolean;
  /** Offset of `<` and offset just after `>`. */
  start: number;
  end: number;
}

const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\r';

/** Start tags whose local name is `local`, in document order, up to `cap` tags. Returns whether the cap was hit. */
export function startTags(xml: string, local: string, cap = 100_000): { tags: XmlTag[]; capped: boolean } {
  const tags: XmlTag[] = [];
  let i = xml.indexOf('<');
  while (i !== -1) {
    const c = xml[i + 1];
    if (c !== undefined && c !== '/' && c !== '!' && c !== '?') {
      let j = i + 1;
      while (j < xml.length && j - i < 200 && !isSpace(xml[j]) && xml[j] !== '>' && xml[j] !== '/') j++;
      const name = xml.slice(i + 1, j);
      const colon = name.lastIndexOf(':');
      const l = colon === -1 ? name : name.slice(colon + 1);
      if (l === local) {
        if (tags.length >= cap) return { tags, capped: true };
        // Scan to the closing '>' honouring quotes.
        let k = j;
        let quote = '';
        const attrs = new Map<string, string>();
        let selfClosing = false;
        let closed = false;
        while (k < xml.length && k - i < MAX_TAG) {
          const ch = xml[k]!;
          if (quote) {
            if (ch === quote) quote = '';
            k++;
            continue;
          }
          if (ch === '"' || ch === "'") {
            quote = ch;
            k++;
            continue;
          }
          if (ch === '>') {
            closed = true;
            break;
          }
          k++;
        }
        if (closed) {
          const inner = xml.slice(j, k);
          selfClosing = inner.trimEnd().endsWith('/');
          parseAttrs(inner, attrs);
          tags.push({ name, local, attrs, selfClosing, start: i, end: k + 1 });
          i = xml.indexOf('<', k + 1);
          continue;
        }
      }
    }
    i = xml.indexOf('<', i + 1);
  }
  return { tags, capped: false };
}

function parseAttrs(s: string, out: Map<string, string>): void {
  let i = 0;
  let guard = 0;
  while (i < s.length && guard++ < 200) {
    while (i < s.length && (isSpace(s[i]) || s[i] === '/')) i++;
    let j = i;
    while (j < s.length && s[j] !== '=' && !isSpace(s[j]) && s[j] !== '/') j++;
    const name = s.slice(i, j);
    i = j;
    while (i < s.length && isSpace(s[i])) i++;
    if (s[i] !== '=' || name === '') {
      i++;
      continue;
    }
    i++;
    while (i < s.length && isSpace(s[i])) i++;
    const q = s[i];
    if (q !== '"' && q !== "'") continue;
    const end = s.indexOf(q, i + 1);
    if (end === -1) return;
    const colon = name.lastIndexOf(':');
    const key = colon === -1 ? name : name.slice(colon + 1);
    if (!out.has(key)) out.set(key, decodeEntities(s.slice(i + 1, end)));
    i = end + 1;
  }
}

/** Text content of the first element with this local name (tags inside are dropped, entities decoded). */
export function elementText(xml: string, local: string, maxChars = 4000): string | null {
  const { tags } = startTags(xml, local, 20);
  for (const t of tags) {
    if (t.selfClosing) continue;
    const close = findClose(xml, t);
    if (close === -1) continue;
    const text = decodeEntities(xml.slice(t.end, Math.min(close, t.end + maxChars * 4)).replace(/<[^>]*>/g, '')).trim();
    if (text) return text.slice(0, maxChars);
  }
  return null;
}

/** Offset of the matching `</prefix:local>` for a start tag (first closing tag with that name; nesting of the same name is not tracked). */
export function findClose(xml: string, tag: XmlTag): number {
  return xml.indexOf(`</${tag.name}`, tag.end);
}

/** Distinct values of an attribute (by local name) on start tags with this local name. */
export function distinctAttrValues(xml: string, local: string, attr: string, cap: number): { values: string[]; total: number; capped: boolean } {
  const { tags, capped } = startTags(xml, local, 200_000);
  const set = new Set<string>();
  for (const t of tags) {
    const v = t.attrs.get(attr);
    if (v !== undefined && set.size < cap) set.add(v.slice(0, 300));
  }
  return { values: [...set], total: tags.length, capped };
}
