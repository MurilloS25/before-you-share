import type { FormatId } from '../../core/limits';
import type { Category, EvidenceLocation, EvidenceStatus } from '../../core/types';

export const CATEGORY_LABEL: Record<Category, string> = {
  location: 'Location',
  identity: 'Identity',
  time: 'Time',
  'device-software': 'Device and software',
  'document-properties': 'Document properties',
  'embedded-content': 'Embedded content',
  'active-features': 'Active features',
  structural: 'Structure',
  unsupported: 'Not inspected',
};

export const CATEGORY_HINT: Record<Category, string> = {
  location: 'Where something was taken or made.',
  identity: 'Names and identifiers that can point to a person, organisation or device.',
  time: 'When something was created or changed.',
  'device-software': 'The equipment and programs involved.',
  'document-properties': 'Titles, descriptions and other stored text.',
  'embedded-content': 'Content stored inside the file that may not be visible.',
  'active-features': 'Scripts and actions. This tool never runs them.',
  structural: 'How the file is built. Usually ordinary.',
  unsupported: 'Things present that this tool could not read.',
};

export const STATUS_LABEL: Record<EvidenceStatus, string> = {
  verified: 'Verified',
  inferred: 'Inferred',
  suspicious: 'Suspicious',
  unsupported: 'Not supported',
  unavailable: 'Unavailable',
};

export const STATUS_HELP: Record<EvidenceStatus, string> = {
  verified: 'Read directly from the file.',
  inferred: 'Suggested by names or patterns; not parsed in full.',
  suspicious: 'Unusual or inconsistent, which does not mean harmful.',
  unsupported: 'Present, but this tool cannot decode it.',
  unavailable: 'Could not be checked.',
};

export const FORMAT_LABEL: Record<FormatId, string> = { jpeg: 'JPEG image', png: 'PNG image', pdf: 'PDF document' };

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MiB`;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function describeLocation(l: EvidenceLocation): string {
  if (l.kind === 'bytes') {
    const end = l.offset + Math.max(l.length - 1, 0);
    return l.length === 0 ? `Byte ${l.offset.toLocaleString('en-US')}` : `Bytes ${l.offset.toLocaleString('en-US')} to ${end.toLocaleString('en-US')} (${plural(l.length, 'byte')})`;
  }
  if (l.kind === 'structure') return l.path;
  return 'Not tied to a byte range';
}

/** Name for the downloaded copy: clearly different from the original, safe on every filesystem, text only. */
export function downloadName(original: string, format: 'jpeg' | 'png'): string {
  const dot = original.lastIndexOf('.');
  const stem = (dot > 0 ? original.slice(0, dot) : original).split(/[\\/]/).pop() ?? '';
  let cleaned = stem
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\u061c\ufeff]/g, '')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80);
  // Windows reserved device names (CON, NUL, COM1 ...) cannot be used as a file stem.
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(cleaned)) cleaned = `_${cleaned}`;
  return `${cleaned || 'file'}.experimental-copy.${format === 'jpeg' ? 'jpg' : 'png'}`;
}
