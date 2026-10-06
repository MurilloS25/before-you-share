export interface InflateResult {
  bytes: Uint8Array;
  /** True when output was cut at `max` (possible decompression bomb or just a large chunk). */
  truncated: boolean;
  /** True when the stream was invalid. `bytes` then holds whatever decoded before the error. */
  error: boolean;
  /** Total compressed bytes consumed is not tracked; callers know the input size. */
}

/**
 * Inflate zlib data with a hard output cap. Reading stops (and the stream is cancelled) as soon as
 * more than `max` bytes would be produced, so a bomb costs at most `max` plus one chunk of memory.
 */
export async function inflateBounded(data: Uint8Array, max: number, format: 'deflate' | 'deflate-raw' = 'deflate'): Promise<InflateResult> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  let error = false;
  if (typeof DecompressionStream === 'undefined') return { bytes: new Uint8Array(0), truncated: false, error: true };
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  const copy = new Uint8Array(data); // the stream may detach/transfer its input
  void writer
    .write(copy)
    .then(() => writer.close())
    .catch(() => undefined);
  const reader = ds.readable.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > max) {
        const room = max - total;
        if (room > 0) chunks.push(value.subarray(0, room));
        total = max;
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } catch {
    error = true;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return { bytes: out, truncated, error };
}
