import type { FormatId } from './limits';
import type { Fingerprint } from './types';

export interface Detection {
  /** Supported format, or null. */
  format: FormatId | null;
  /** Canonical MIME for the detected content, or a descriptive label for recognised-but-unsupported content. */
  mime: string;
  /** Human label. */
  label: string;
  /** Content recognised by signature but without support in this tool. */
  recognisedUnsupported: boolean;
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** How many leading bytes detection needs. PDF headers may be preceded by up to 1024 bytes of junk. */
export const SNIFF_BYTES = 1032;

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(b: Uint8Array, sig: number[], at = 0): boolean {
  if (b.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[at + i] !== sig[i]) return false;
  return true;
}
function ascii(b: Uint8Array, text: string, at = 0): boolean {
  return startsWith(
    b,
    Array.from(text, (c) => c.charCodeAt(0)),
    at,
  );
}

/** Identify the format from content only. Extension and declared MIME are never consulted here. */
export function detectFormat(head: Uint8Array): Detection {
  if (startsWith(head, PNG_SIG)) {
    return { format: 'png', mime: 'image/png', label: 'PNG image', recognisedUnsupported: false };
  }
  if (startsWith(head, [0xff, 0xd8, 0xff])) {
    return { format: 'jpeg', mime: 'image/jpeg', label: 'JPEG image', recognisedUnsupported: false };
  }
  if (ascii(head, 'GIF87a') || ascii(head, 'GIF89a')) return unsupported('image/gif', 'GIF image');
  if (ascii(head, 'RIFF') && ascii(head, 'WEBP', 8)) return unsupported('image/webp', 'WebP image');
  if (ascii(head, 'ftyp', 4)) return unsupported('video/mp4 or image/heic', 'ISO media container (MP4, HEIC, AVIF)');
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])) {
    return unsupported('application/zip', 'ZIP-based container (for example DOCX, XLSX, PPTX)');
  }
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) {
    return unsupported('image/tiff', 'TIFF image');
  }
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0])) return unsupported('application/x-ole-storage', 'Legacy Office (OLE) document');
  // PDF: "%PDF-" is allowed within the first 1024 bytes.
  const limit = Math.min(head.length - 5, 1024);
  for (let i = 0; i <= limit; i++) {
    if (head[i] === 0x25 && ascii(head, '%PDF-', i)) {
      return { format: 'pdf', mime: 'application/pdf', label: 'PDF document', recognisedUnsupported: false };
    }
  }
  return { format: null, mime: 'unknown', label: 'Unrecognised content', recognisedUnsupported: false };
}

function unsupported(mime: string, label: string): Detection {
  return { format: null, mime, label, recognisedUnsupported: true };
}

const EXT_FOR: Record<FormatId, string[]> = {
  jpeg: ['jpg', 'jpeg', 'jpe', 'jfif'],
  png: ['png'],
  pdf: ['pdf'],
  docx: ['docx', 'docm', 'dotx', 'dotm'],
};

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const i = base.lastIndexOf('.');
  return i > 0 && i < base.length - 1 ? base.slice(i + 1).toLowerCase().slice(0, 16) : '';
}

export function buildFingerprint(
  size: number,
  name: string,
  declaredType: string,
  detection: Detection,
  sha256: string | null,
): Fingerprint {
  const extension = extensionOf(name);
  const fmt = detection.format;
  let extensionCheck: Fingerprint['extensionCheck'] = 'unknown';
  if (fmt && extension) extensionCheck = EXT_FOR[fmt].includes(extension) ? 'match' : 'mismatch';
  let declaredTypeCheck: Fingerprint['declaredTypeCheck'] = 'unknown';
  if (fmt && declaredType) declaredTypeCheck = declaredType.toLowerCase() === detection.mime ? 'match' : 'mismatch';
  return {
    size,
    declaredType: declaredType.slice(0, 100),
    detectedType: detection.mime,
    detectedFormat: fmt,
    extension,
    extensionCheck,
    declaredTypeCheck,
    sha256,
  };
}
