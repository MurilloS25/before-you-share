import { latin } from './jpeg';

/** Tiny deterministic PDF writer for synthetic fixtures. Strings are Latin-1. */
export class PdfWriter {
  private parts: string[] = [];
  private pos = 0;
  readonly offsets = new Map<number, number>();

  constructor(version = '1.7') {
    this.raw(`%PDF-${version}\n%âãÏÓ\n`);
  }
  private raw(s: string): void {
    this.parts.push(s);
    this.pos += s.length;
  }
  obj(n: number, body: string): this {
    this.offsets.set(n, this.pos);
    this.raw(`${n} 0 obj\n${body}\nendobj\n`);
    return this;
  }
  stream(n: number, dict: string, data: string): this {
    return this.obj(n, `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`);
  }
  /** Full cross-reference table plus trailer. */
  finish(size: number, trailer: string, opts: { prev?: number; only?: number[] } = {}): this {
    const start = this.pos;
    let x = 'xref\n';
    if (opts.only) {
      for (const n of opts.only) x += `${n} 1\n${String(this.offsets.get(n)!).padStart(10, '0')} 00000 n \n`;
    } else {
      x += `0 ${size}\n0000000000 65535 f \n`;
      for (let i = 1; i < size; i++) {
        const o = this.offsets.get(i);
        x += o === undefined ? '0000000000 65535 f \n' : `${String(o).padStart(10, '0')} 00000 n \n`;
      }
    }
    x += `trailer\n<< /Size ${size} ${trailer}${opts.prev !== undefined ? ` /Prev ${opts.prev}` : ''} >>\nstartxref\n${start}\n%%EOF\n`;
    this.raw(x);
    this.lastXref = start;
    return this;
  }
  lastXref = 0;
  bytes(): Uint8Array {
    return latin(this.parts.join(''));
  }
}

export interface PdfOptions {
  info?: boolean;
  extraCatalog?: string;
  extraPage?: string;
  extraObjects?: Array<[number, string]>;
  streams?: Array<[number, string, string]>;
  infoOverrides?: string;
  pagesCount?: number;
  id?: boolean;
  trailerExtra?: string;
  size?: number;
}

/** A one-page document. Objects 1-6 are fixed; extras use 7 and up. */
export function basicPdf(o: PdfOptions = {}): { w: PdfWriter; size: number } {
  const w = new PdfWriter();
  w.obj(1, `<< /Type /Catalog /Pages 2 0 R${o.extraCatalog ? ' ' + o.extraCatalog : ''} >>`);
  w.obj(2, `<< /Type /Pages /Kids [3 0 R] /Count ${o.pagesCount ?? 1} >>`);
  w.obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >>${o.extraPage ? ' ' + o.extraPage : ''} >>`);
  w.stream(4, '', 'BT /F1 12 Tf 20 100 Td (Fixture page) Tj ET');
  w.obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  w.obj(6, `<< ${o.infoOverrides ?? ''} >>`);
  for (const [n, body] of o.extraObjects ?? []) w.obj(n, body);
  for (const [n, dict, data] of o.streams ?? []) w.stream(n, dict, data);
  const maxObj = Math.max(6, ...[...w.offsets.keys()]);
  const size = o.size ?? maxObj + 1;
  w.finish(size, `/Root 1 0 R${o.info === false ? '' : ' /Info 6 0 R'}${o.id === false ? '' : ' /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]'}${o.trailerExtra ? ' ' + o.trailerExtra : ''}`);
  return { w, size };
}

export const SYNTH_INFO =
  '/Title (Fixture Document) /Author (Example Person) /Subject (Synthetic subject) /Keywords (fixture, example) /Creator (Fixture Writer) /Producer (Fixture PDF Library 1.0) /CreationDate (D:20000101000000Z) /ModDate (D:20000102000000Z)';
