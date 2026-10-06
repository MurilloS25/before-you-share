import { describe, expect, it } from 'vitest';
import { displayText } from '../src/core/bytes';
import { downloadName, describeLocation, formatBytes } from '../src/ui/lib/format';

describe('download name', () => {
  it('is clearly different and carries the detected extension, not the original one', () => {
    expect(downloadName('holiday.PNG', 'jpeg')).toBe('holiday.experimental-copy.jpg');
    expect(downloadName('a.b.c.jpg', 'jpeg')).toBe('a.b.c.experimental-copy.jpg');
    expect(downloadName('noext', 'png')).toBe('noext.experimental-copy.png');
  });

  it('removes path parts, controls, bidi and zero-width characters', () => {
    const hostile = 'C:' + String.fromCharCode(92) + 'dir' + String.fromCharCode(92) + 'na' + String.fromCharCode(0x202e) + 'me' + String.fromCharCode(0x200b) + String.fromCharCode(0xfeff) + '<x>.jpg';
    const n = downloadName(hostile, 'jpeg');
    expect(n).toBe('name_x_.experimental-copy.jpg');
    expect(n).not.toMatch(/[/\\<>]/);
  });

  it('prefixes Windows reserved device names and never returns an empty stem', () => {
    expect(downloadName('CON.jpg', 'jpeg')).toBe('_CON.experimental-copy.jpg');
    expect(downloadName('com1.png', 'png')).toBe('_com1.experimental-copy.png');
    expect(downloadName('...jpg', 'jpeg')).toBe('file.experimental-copy.jpg');
    expect(downloadName('', 'jpeg')).toBe('file.experimental-copy.jpg');
  });

  it('limits the stem to 80 characters', () => {
    expect(downloadName('x'.repeat(500) + '.jpg', 'jpeg')).toBe('x'.repeat(80) + '.experimental-copy.jpg');
  });
});

describe('text sanitising for display', () => {
  it('replaces control, bidi and zero-width characters and truncates', () => {
    const s = 'a' + String.fromCharCode(0x202e) + 'b' + String.fromCharCode(0x200b) + 'c' + String.fromCharCode(1) + 'd';
    expect(displayText(s)).toBe('a\ufffdb\ufffdc\ufffdd');
    expect(displayText('x'.repeat(10), 4)).toContain('6 more characters not shown');
  });
});

describe('formatting helpers', () => {
  it('formats sizes and locations', () => {
    expect(formatBytes(512)).toBe('512 bytes');
    expect(formatBytes(2048)).toBe('2.0 KiB');
    expect(describeLocation({ kind: 'bytes', offset: 10, length: 5 })).toBe('Bytes 10 to 14 (5 bytes)');
    expect(describeLocation({ kind: 'none' })).toBe('Not tied to a byte range');
  });
});
