import { LIMITS } from '../core/limits';
import type { FormatId } from '../core/limits';
import type { DecodeComparison } from '../transform/verify';

const MIME: Record<'jpeg' | 'png', string> = { jpeg: 'image/jpeg', png: 'image/png' };

async function decode(bytes: Uint8Array, format: 'jpeg' | 'png'): Promise<{ bitmap: ImageBitmap }> {
  const blob = new Blob([bytes as BlobPart], { type: MIME[format] });
  // 'from-image' applies EXIF orientation identically to both files, so orientation changes would show up as pixel differences.
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
  return { bitmap };
}

function pixels(bitmap: ImageBitmap): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
}

/**
 * Decode both files with the browser's own decoder and compare them. Bounded: images above the compare
 * limit are not decoded at all. Memory is released as soon as each bitmap has been compared.
 */
export async function compareDecoded(original: Uint8Array, copy: Uint8Array, format: FormatId, declared: { width: number; height: number } | null): Promise<DecodeComparison> {
  if (format === 'pdf') return { dimensionsEqual: null, pixelsIdentical: null, detail: 'Not applicable to PDF.', failed: false };
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    return { dimensionsEqual: null, pixelsIdentical: null, detail: 'This browser cannot decode images in a worker, so the visual comparison was skipped.', failed: false };
  }
  if (declared && declared.width * declared.height > LIMITS.maxComparePixels) {
    return { dimensionsEqual: null, pixelsIdentical: null, detail: 'The image is too large for an exact pixel comparison in this tool.', failed: false };
  }
  let a: ImageBitmap | null = null;
  let b: ImageBitmap | null = null;
  try {
    a = (await decode(original, format)).bitmap;
    b = (await decode(copy, format)).bitmap;
    const dimsEqual = a.width === b.width && a.height === b.height;
    if (!dimsEqual) return { dimensionsEqual: false, pixelsIdentical: false, detail: `Decoded sizes differ: ${a.width}×${a.height} and ${b.width}×${b.height}.`, failed: false };
    if (a.width * a.height > LIMITS.maxComparePixels) {
      return { dimensionsEqual: true, pixelsIdentical: null, detail: 'Both files decode with the same dimensions. The image is too large for an exact pixel comparison.', failed: false };
    }
    const pa = pixels(a);
    const pb = pixels(b);
    let same = pa.length === pb.length;
    for (let i = 0; same && i < pa.length; i++) if (pa[i] !== pb[i]) same = false;
    return {
      dimensionsEqual: true,
      pixelsIdentical: same,
      detail: same
        ? `Both files decode to ${a.width}×${a.height} pixels and every decoded pixel is identical.`
        : 'The decoded pixels differ between the original and the copy.',
      failed: false,
    };
  } catch {
    return { dimensionsEqual: null, pixelsIdentical: null, detail: 'This browser could not decode one of the files.', failed: true };
  } finally {
    a?.close();
    b?.close();
  }
}
