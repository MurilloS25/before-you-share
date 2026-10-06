import { PDFJS_OPTIONS, loadPdfLibrary } from '../formats/pdf';
import type { PdfPreviewResult } from './protocol';

/** pdf.js canvas factory backed by OffscreenCanvas so rendering never needs a DOM. */
class OffscreenCanvasFactory {
  create(width: number, height: number) {
    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(cc: { canvas: OffscreenCanvas }, width: number, height: number): void {
    cc.canvas.width = Math.max(1, width);
    cc.canvas.height = Math.max(1, height);
  }
  destroy(cc: { canvas: OffscreenCanvas | null; context: unknown }): void {
    if (cc.canvas) {
      cc.canvas.width = 0;
      cc.canvas.height = 0;
    }
    cc.canvas = null;
    cc.context = null;
  }
}

const MAX_EDGE = 900;

interface RenderableDoc {
  getPage(n: number): Promise<{
    getViewport(o: { scale: number }): { width: number; height: number };
    render(o: Record<string, unknown>): { promise: Promise<void> };
    cleanup(): void;
  }>;
}

/**
 * Render page 1 to a PNG bitmap. The result is an inert image: no scripts, actions, links, forms or
 * annotations are executed or kept. Annotations are not drawn (annotationMode 0).
 */
export async function renderPdfFirstPage(bytes: Uint8Array): Promise<PdfPreviewResult> {
  const lib = await loadPdfLibrary();
  const task = lib.getDocument({ ...PDFJS_OPTIONS, data: new Uint8Array(bytes), CanvasFactory: OffscreenCanvasFactory });
  try {
    const doc = (await task.promise) as unknown as RenderableDoc;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, MAX_EDGE / Math.max(base.width, base.height, 1));
    const viewport = page.getViewport({ scale });
    const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport, annotationMode: 0, intent: 'display' }).promise;
    page.cleanup();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { kind: 'pdf-preview', png: await blob.arrayBuffer(), width: canvas.width, height: canvas.height };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
