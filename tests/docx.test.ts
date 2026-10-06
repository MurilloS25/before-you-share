import { describe, expect, it } from 'vitest';
import { analyseBytes } from '../src/core/analyze';
import { detectFormat } from '../src/core/detect';
import { LIMITS } from '../src/core/limits';
import { looksLikeDocx } from '../src/formats/docx';
import { readZipDirectory, readZipEntry } from '../src/formats/zip';
import { removalGroupsFor } from '../src/transform/groups';
import { createCopy } from '../src/transform/verify';
import { RefusedError } from '../src/core/errors';
import { analyseFixture, byCode, fixture, outcomeOf, valueOf } from './helpers';
import { enc, cat } from '../fixtures/lib/jpeg';
import { buildDocx, zip } from '../fixtures/lib/docx';

describe('DOCX detection', () => {
  it('recognises a Word package by its directory, not by name or magic alone', async () => {
    const r = await analyseFixture('docx-basic.docx');
    expect(r.format).toBe('docx');
    expect(r.fingerprint.detectedType).toContain('wordprocessingml');
    expect(r.copyRefusal).toMatch(/not offered for DOCX/);
    expect(removalGroupsFor(r)).toEqual([]);
  });

  it('keeps an ordinary ZIP unsupported and a damaged package unsupported (nothing is guessed)', async () => {
    for (const f of ['zip-not-docx.zip', 'docx-truncated.docx']) {
      const out = await outcomeOf(f);
      expect(out.supported, f).toBe(false);
    }
    expect(detectFormat(fixture('zip-not-docx.zip')).recognisedUnsupported).toBe(true);
  });

  it('reports a DOCX with the wrong extension as a mismatch', async () => {
    const r = await analyseFixture('docx-fake-extension.png', 'image/png');
    expect(r.format).toBe('docx');
    expect(byCode(r, 'file.type-mismatch')).toHaveLength(1);
  });

  it('refuses a DOCX over its size limit by never analysing it', async () => {
    const big = zip(buildDocx({ extra: [{ name: 'word/media/pad.bin', data: new Uint8Array(1024), method: 0 }] }));
    const padded = cat(big, new Uint8Array(LIMITS.maxFileBytes.docx));
    const out = await analyseBytes(padded, { name: 'big.docx', type: '' });
    expect(out.supported).toBe(false); // too large to be examined as a DOCX, so it stays an unsupported ZIP container
  });
});

describe('DOCX inspection', () => {
  it('reads core and app properties with sources and normalised dates', async () => {
    const r = await analyseFixture('docx-basic.docx');
    expect(valueOf(r, 'docx.author')).toBe('Example Person');
    expect(valueOf(r, 'docx.last-modified-by')).toBe('Example Reviewer');
    expect(valueOf(r, 'docx.created')).toBe('2000-01-01T00:00:00Z');
    expect(valueOf(r, 'docx.company')).toBe('Example Organisation');
    expect(byCode(r, 'docx.company').map((f) => f.value)).toEqual(['Example Organisation', 'Example Manager']);
    expect(valueOf(r, 'docx.template')).toBe('FixtureTemplate.dotm');
    expect(valueOf(r, 'docx.editing-time')).toBe('42');
    expect(valueOf(r, 'docx.revision')).toBe('3');
    expect(valueOf(r, 'docx.application')).toBe('Fixture Word 1.0');
    const author = byCode(r, 'docx.author')[0]!;
    expect(author).toMatchObject({ category: 'identity', status: 'verified', removable: false, transformation: 'unsupported' });
    expect(author.source).toContain('docProps/core.xml');
  });

  it('counts comments, tracked changes, hidden text and editing sessions without showing their text', async () => {
    const r = await analyseFixture('docx-comments-tracked.docx');
    expect(valueOf(r, 'docx.comments')).toContain('2 comments');
    expect(valueOf(r, 'docx.comment-authors')).toBe('Example Reviewer; Second Reviewer');
    expect(valueOf(r, 'docx.tracked-changes')).toContain('1 insertion and 1 deletion');
    expect(valueOf(r, 'docx.tracked-authors')).toContain('Second Reviewer');
    expect(valueOf(r, 'docx.hidden-text')).toContain('2 runs');
    expect(valueOf(r, 'docx.rsid')).toContain('3 distinct');
    const text = JSON.stringify(r.findings.map((f) => f.value));
    expect(text).not.toContain('Synthetic comment one');
    expect(text).not.toContain('deleted words');
    expect(byCode(r, 'docx.comments')[0]!.limitations.join(' ')).toMatch(/not displayed/);
  });

  it('lists embedded media, objects, thumbnail, custom XML, custom properties and external references', async () => {
    const r = await analyseFixture('docx-embedded.docx');
    expect(valueOf(r, 'docx.media')).toContain('image1.png');
    expect(valueOf(r, 'docx.embedded-objects')).toContain('oleObject1.bin');
    expect(byCode(r, 'docx.thumbnail')).toHaveLength(1);
    expect(valueOf(r, 'docx.custom-xml')).toContain('1 part');
    expect(valueOf(r, 'docx.custom')).toContain('ProjectCode = FIXTURE-001');
    const ext = valueOf(r, 'docx.external')!;
    expect(ext).toContain('2 external references');
    expect(ext).toContain('file:///C:/Users/ExamplePerson/Templates/Fixture.dotm');
    expect(byCode(r, 'docx.external')[0]!.limitations.join(' ')).toMatch(/never followed/);
    expect(byCode(r, 'docx.media')[0]!.category).toBe('embedded-content');
  });

  it('reports macros and signature parts as indicators and never runs or opens them', async () => {
    const r = await analyseFixture('docx-macro.docx');
    expect(byCode(r, 'docx.macros')[0]).toMatchObject({ category: 'active-features', status: 'verified' });
    expect(byCode(r, 'docx.macros')[0]!.limitations.join(' ')).toMatch(/never run/);
    expect(byCode(r, 'docx.signature')).toHaveLength(1);
    expect(r.docx!.macroEnabled).toBe(true);
  });

  it('keeps hostile property values as plain text', async () => {
    const r = await analyseFixture('docx-hostile-metadata.docx');
    expect(valueOf(r, 'docx.author')).toBe('<img src=x onerror=alert(1)><script>alert(2)</script>');
    for (const f of r.findings) expect(f.value ?? '').not.toMatch(/[\u202a-\u202e\u2066-\u2069\u0001]/);
  });

  it('never offers a copy', async () => {
    const r = await analyseFixture('docx-basic.docx');
    await expect(createCopy(fixture('docx-basic.docx'), r, ['x'])).rejects.toBeInstanceOf(RefusedError);
  });

  it('states coverage honestly', async () => {
    const r = await analyseFixture('docx-basic.docx');
    expect(r.coverage.find((c) => c.area.startsWith('Document text'))!.state).toBe('not-inspected');
    expect(r.coverage.find((c) => c.area === 'Content inside embedded files')!.state).toBe('not-inspected');
  });
});

describe('DOCX hostile packages', () => {
  it('flags a compression bomb from honest sizes and reads at most the per-part cap', async () => {
    const bytes = fixture('docx-zipbomb.docx');
    expect(bytes.length).toBeLessThan(300_000);
    const t = Date.now();
    const r = await analyseFixture('docx-zipbomb.docx');
    expect(Date.now() - t).toBeLessThan(3000);
    const f = byCode(r, 'docx.zip-suspicious')[0]!;
    expect(f.status).toBe('suspicious');
    expect(f.value).toMatch(/compression bomb/);
    const dir = readZipDirectory(bytes);
    const bomb = dir.entries.find((e) => e.name === 'word/media/bomb.bin')!;
    const part = await readZipEntry(bytes, bomb, LIMITS.maxZipPartBytes);
    expect(part.bytes.length).toBe(LIMITS.maxZipPartBytes);
    expect(part.truncated).toBe(true);
  });

  it('does not trust declared sizes', async () => {
    const r = await analyseFixture('docx-lying-sizes.docx');
    expect(byCode(r, 'docx.zip-suspicious')[0]!.value).toMatch(/declares [\d,]+ bytes when unpacked/);
  });

  it('flags path traversal and duplicate names and extracts nothing', async () => {
    const r = await analyseFixture('docx-path-traversal.docx');
    expect(valueOf(r, 'docx.zip-suspicious')).toContain('../evil.txt');
    const d = await analyseFixture('docx-duplicate-entries.docx');
    expect(valueOf(d, 'docx.zip-suspicious')).toContain('1 duplicated entry name');
    expect(valueOf(d, 'docx.author')).toBe('Example Person'); // the first entry wins
  });

  it('reports encrypted entries and does not read them', async () => {
    const r = await analyseFixture('docx-encrypted-entry.docx');
    expect(byCode(r, 'docx.encrypted')[0]).toMatchObject({ category: 'unsupported', status: 'verified' });
  });

  it('caps the number of entries', async () => {
    const r = await analyseFixture('docx-many-entries.docx');
    expect(byCode(r, 'docx.limit')).toHaveLength(1);
    expect(r.findings.find((f) => f.code === 'docx.zip-entries')!.value).toContain(`${LIMITS.maxZipEntries} entries`);
  });

  it('survives random corruption of a valid package', async () => {
    const src = fixture('docx-comments-tracked.docx');
    for (let seed = 1; seed <= 60; seed++) {
      const b = Uint8Array.from(src);
      let x = seed * 2654435761;
      for (let k = 0; k < 6; k++) {
        x = (x * 1664525 + 1013904223) >>> 0;
        b[x % b.length] = (x >>> 8) & 255;
      }
      const cut = seed % 5 === 0 ? b.subarray(0, (x >>> 4) % b.length) : b;
      const out = await analyseBytes(cut, { name: 'f.docx', type: '' });
      if (out.supported) for (const f of out.report.findings) expect(f.code === 'limit.findings' || typeof f.id === 'string').toBe(true);
    }
  });

  it('zip directory reader refuses ZIP64 and bad directories without throwing', () => {
    expect(readZipDirectory(new Uint8Array(10)).invalid).not.toBeNull();
    expect(readZipDirectory(enc('PK\u0003\u0004 no directory here, just text padding padding padding')).invalid).not.toBeNull();
    expect(looksLikeDocx(readZipDirectory(fixture('zip-not-docx.zip')))).toBe(false);
  });
});

describe('DOCX XML handling (review findings)', () => {
  const pkg = (parts: Record<string, string>) =>
    zip([
      { name: '[Content_Types].xml', data: enc('<Types/>') },
      { name: 'word/document.xml', data: enc(parts['word/document.xml'] ?? '<w:document/>') },
      ...Object.entries(parts)
        .filter(([n]) => n !== 'word/document.xml')
        .map(([name, xml]) => ({ name, data: enc(xml) })),
    ]);
  const run = async (parts: Record<string, string>) => {
    const out = await analyseBytes(pkg(parts), { name: 'x.docx', type: '' });
    if (!out.supported) throw new Error('unsupported');
    return out.report;
  };

  it('pairs custom property values with the right names even with non-string properties', async () => {
    const r = await run({
      'docProps/custom.xml':
        '<Properties xmlns:vt="v"><property name="Count"><vt:i4>5</vt:i4></property><property name="Empty"><vt:lpwstr></vt:lpwstr></property><property name="Secret"><vt:lpwstr>hunter2</vt:lpwstr></property></Properties>',
    });
    expect(valueOf(r, 'docx.custom')).toBe('3 properties: Count = 5; Empty; Secret = hunter2');
  });

  it('finds external relationships however the tag is written', async () => {
    const r = await run({
      'word/_rels/document.xml.rels':
        "<Relationships><Relationship Id='r1' Type='x/attachedTemplate' Target='file:///C:/Users/a/b.dotm' TargetMode='External'/>" +
        '<Relationship\n Id="r2" Type="x/oleObject" Target="file:///C:/Users/bob/a>b.dotm" TargetMode="External"/>' +
        '<Relationship Id="r3" Type="x/image" Target="media/i.png"/></Relationships>',
    });
    const v = valueOf(r, 'docx.external')!;
    expect(v).toContain('2 external references');
    expect(v).toContain('a>b.dotm');
    expect(v).toContain('file:///C:/Users/a/b.dotm');
  });

  it('reports a cap on relationships instead of silently dropping the rest', async () => {
    const many = Array.from({ length: 2100 }, (_, i) => `<Relationship Id="r${i}" Type="x/image" Target="m/${i}.png"/>`).join('');
    const r = await run({ 'word/_rels/document.xml.rels': `<Relationships>${many}</Relationships>` });
    expect(byCode(r, 'docx.limit').some((f) => /2,000 relationships/.test(f.value ?? ''))).toBe(true);
  });

  it('counts tracked changes and hidden text regardless of whitespace, and ignores XML comments and CDATA', async () => {
    const r = await run({
      'word/document.xml':
        '<w:document><w:body><w:ins\n w:id="1" w:author="Real Author"><w:r/></w:ins><w:del\tw:id="2" w:author="Other"><w:r/></w:del>' +
        '<!-- <w:ins w:author="Fake"/> <w:vanish/> --><![CDATA[<w:ins w:author="Fake2"/>]]>' +
        '<w:r><w:rPr><w:vanish/></w:rPr></w:r><w:r><w:rPr><w:vanish w:val="0"/></w:rPr></w:r></w:body></w:document>',
    });
    expect(valueOf(r, 'docx.tracked-changes')).toContain('1 insertion and 1 deletion');
    expect(valueOf(r, 'docx.tracked-authors')).toBe('Real Author; Other');
    expect(valueOf(r, 'docx.hidden-text')).toContain('1 run');
  });

  it('does not stop at a very long attribute value and matches whole attribute names', async () => {
    const r = await run({
      'word/document.xml': `<w:document><w:ins w:author="${'A'.repeat(500)}"/><w:ins w:author="Bob" w:rename="NotAnAuthor"/></w:document>`,
    });
    expect(valueOf(r, 'docx.tracked-authors')).toContain('Bob');
    expect(valueOf(r, 'docx.tracked-authors')).not.toContain('NotAnAuthor');
  });

  it('reads properties with any namespace prefix and CDATA values', async () => {
    const r = await run({
      'docProps/core.xml': '<d:coreProperties xmlns:d="x"><d:creator><![CDATA[Jane <Doe> & Co]]></d:creator><d:title>a<!-- x > y -->b</d:title></d:coreProperties>',
    });
    expect(valueOf(r, 'docx.author')).toBe('Jane <Doe> & Co');
    expect(valueOf(r, 'docx.property')).toBe('ab');
  });

  it('says counts are lower bounds when a part was read only in part', async () => {
    const big = '<w:document><w:body>' + '<w:ins w:id="1" w:author="A"/>'.repeat(40_000) + '</w:body></w:document>';
    const r = await run({ 'word/document.xml': big });
    // 40,000 insertions are about 1.1 MB: below the 2 MiB document cap, so counted in full
    expect(valueOf(r, 'docx.tracked-changes')).toContain('40000 insertions');
    const huge = '<w:document>' + '<w:ins w:author="A"/>'.repeat(120_000) + '</w:document>';
    const r2 = await run({ 'word/document.xml': huge });
    expect(valueOf(r2, 'docx.tracked-changes')).toMatch(/^At least /);
    expect(byCode(r2, 'docx.limit').length).toBeGreaterThan(0);
    expect(byCode(r2, 'docx.tracked-changes')[0]!.status).toBe('inferred');
  });

  it('coverage never claims comments and tracked changes were fully inspected', async () => {
    const r = await analyseFixture('docx-comments-tracked.docx');
    expect(r.coverage.find((c) => c.area === 'Comments and tracked changes')!.state).toBe('partial');
  });

  it('refuses a part whose local header name differs from the directory', async () => {
    const good = fixture('docx-basic.docx');
    const bad = Uint8Array.from(good);
    const at = Buffer.from(bad).indexOf('docProps/core.xml');
    bad[at] = 0x44; // local header now says "DocProps/core.xml"
    const out = await analyseBytes(bad, { name: 'x.docx', type: '' });
    if (!out.supported) throw new Error('unsupported');
    expect(out.report.findings.some((f) => f.code === 'docx.malformed' && /local header name differs/.test(f.value ?? ''))).toBe(true);
  });
});
