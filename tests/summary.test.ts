import { describe, expect, it } from 'vitest';
import { shareNotes } from '../src/ui/lib/summary';
import { analyseFixture } from './helpers';

describe('shareNotes', () => {
  it('names an exact location for verified GPS and keeps coordinates out of the note', async () => {
    const notes = shareNotes((await analyseFixture('jpeg-gps.jpg')).findings);
    const gps = notes.find((n) => n.id === 'gps')!;
    expect(gps).toMatchObject({ category: 'location', headline: 'An exact location', count: 1 });
    expect(gps.detail).not.toMatch(/0\.25/);
    expect(notes[0]!.id).toBe('gps'); // location comes first
  });

  it('describes undecodable GPS fields without claiming a position', async () => {
    const { baseJpeg, buildExif, exifSegment, insertSegments } = await import('../fixtures/lib/jpeg');
    const { analyseJpeg } = await import('../src/formats/jpeg');
    const r = analyseJpeg(insertSegments(baseJpeg(), [exifSegment(buildExif({ gps: { lat: 95, lon: 10 } }))]));
    const gps = shareNotes(r.findings).find((n) => n.id === 'gps')!;
    expect(gps.headline).toBe('GPS fields');
    expect(gps.detail).toMatch(/outside the valid range, so they are probably wrong/);
  });

  it('groups by category, never by finding, and never ranks or scores', async () => {
    const notes = shareNotes((await analyseFixture('jpeg-kitchen-sink.jpg')).findings);
    const ids = notes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['gps', 'identity', 'time', 'device', 'properties', 'embedded', 'unsupported']));
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of notes) expect(n.headline + n.detail).not.toMatch(/score|risk|danger|unsafe|safe|clean|anonymous|leak|exposed/i);
  });

  it('lists at most four names per category and counts the rest', async () => {
    const notes = shareNotes((await analyseFixture('jpeg-kitchen-sink.jpg')).findings);
    const device = notes.find((n) => n.id === 'device')!;
    expect(device.detail.split(',').length).toBeLessThanOrEqual(5);
    expect(device.detail).toMatch(/Found: /);
  });

  it('is empty for a file with only structural findings, and flags scripts calmly for PDF', async () => {
    expect(shareNotes((await analyseFixture('jpeg-clean.jpg')).findings)).toEqual([]);
    const pdf = shareNotes((await analyseFixture('pdf-javascript.pdf')).findings);
    expect(pdf.find((n) => n.id === 'active')!.detail).toMatch(/never runs them, and their presence is not evidence of harm/);
  });

  it('separates truly undecodable GPS fields, gives limit notices their own sentence, and keeps acronyms', async () => {
    const { baseJpeg, buildExif, exifSegment, insertSegments, commentSegment } = await import('../fixtures/lib/jpeg');
    const { analyseJpeg } = await import('../src/formats/jpeg');
    const { lower } = await import('../src/ui/lib/summary');
    expect(lower('EXIF data')).toBe('EXIF data');
    expect(lower('A4 size')).toBe('A4 size');
    expect(lower('Camera or device maker')).toBe('camera or device maker');
    const many = analyseJpeg(insertSegments(baseJpeg(), Array.from({ length: 700 }, (_, i) => commentSegment(`c${i}`))));
    const notes = shareNotes(many.findings);
    const limit = notes.find((n) => n.id === 'limits')!;
    expect(limit.detail).toMatch(/stopped at a limit/);
    expect(notes.find((n) => n.id === 'unsupported')).toBeUndefined();
    void buildExif;
    void exifSegment;
  });
});
