import { concat } from '../core/bytes';
import { crc32 } from '../core/crc32';
import { RefusedError } from '../core/errors';
import type { ManifestEntry, MutationManifest } from '../core/types';
import { POLICY } from './policy';
import { analysePng, classifyChunk, scanPng, PNG_SIGNATURE } from '../formats/png';
import { Reader } from '../core/bytes';
import { parseExif } from '../formats/exif';
import { FindingSink } from '../core/findings';

/** eXIf chunk holding only an Orientation tag (big-endian TIFF), with a valid CRC. */
export function orientationOnlyExifChunk(orientation: number): Uint8Array {
  const data = Uint8Array.of(
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01,
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation & 0xff, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  );
  const body = concat([Uint8Array.of(0x65, 0x58, 0x49, 0x66), data]); // "eXIf"
  const c = crc32(body);
  const len = data.length;
  return concat([
    Uint8Array.of((len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255),
    body,
    Uint8Array.of((c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255),
  ]);
}

export async function sanitisePng(bytes: Uint8Array, groups: string[]): Promise<{ output: Uint8Array; manifest: MutationManifest }> {
  const analysis = await analysePng(bytes);
  if (analysis.copyRefusal) throw new RefusedError(analysis.copyRefusal);
  const scan = scanPng(bytes);
  const selected = new Set(groups);
  const entries: ManifestEntry[] = [];
  const parts: Uint8Array[] = [Uint8Array.from(PNG_SIGNATURE)];
  const r = new Reader(bytes);
  const keepOrientation = analysis.orientation !== null && analysis.orientation !== 1;
  let orientationWritten = false;

  for (const c of scan.chunks) {
    const cls = classifyChunk(c.type);
    const chunkBytes = bytes.subarray(c.offset, c.offset + c.total);
    if (cls.group && !cls.alwaysKeep && selected.has(cls.group)) {
      if (c.type === 'eXIf' && keepOrientation && !orientationWritten) {
        const replacement = orientationOnlyExifChunk(analysis.orientation!);
        parts.push(replacement);
        orientationWritten = true;
        entries.push({ action: 'rewritten', what: 'eXIf chunk replaced by one that holds only the orientation value', group: cls.group, offset: c.offset, bytes: replacement.length, note: `Original chunk: ${c.total} bytes.` });
        continue;
      }
      entries.push({ action: 'removed', what: `${c.type} chunk`, group: cls.group, offset: c.offset, bytes: c.total });
      continue;
    }
    parts.push(chunkBytes);
    if (cls.group && !cls.alwaysKeep) {
      entries.push({ action: 'preserved', what: `${c.type} chunk`, group: cls.group, offset: c.offset, bytes: c.total, note: 'Not selected for removal.' });
    } else if (c.type === 'iCCP' || c.type === 'pHYs' || cls.kind === 'render') {
      entries.push({ action: 'preserved', what: `${c.type} chunk`, offset: c.offset, bytes: c.total, note: 'Kept because it affects how the picture is displayed.' });
    }
  }
  if (scan.iendEnd !== null && scan.iendEnd < bytes.length) {
    const tail = bytes.subarray(scan.iendEnd);
    if (selected.has('trailer')) {
      entries.push({ action: 'removed', what: 'Data after IEND', group: 'trailer', offset: scan.iendEnd, bytes: tail.length });
    } else {
      parts.push(tail);
      entries.push({ action: 'preserved', what: 'Data after IEND', group: 'trailer', offset: scan.iendEnd, bytes: tail.length, note: 'Not selected for removal.' });
    }
  }
  const output = concat(parts);
  const manifest: MutationManifest = {
    schema: 1,
    format: 'png',
    selectedGroups: [...selected].sort(),
    entries,
    inputBytes: bytes.length,
    outputBytes: output.length,
    preservedPolicy: [...POLICY.png.preserved],
    mayChange: [...POLICY.png.mayChange],
  };
  return { output, manifest };
}
