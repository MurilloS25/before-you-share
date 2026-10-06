import type { Category, Finding } from '../../core/types';
import { CATEGORY_LABEL } from './format';

export interface ShareNote {
  /** Stable key. */
  id: string;
  /** Category whose findings section this note points to. */
  category: Category;
  headline: string;
  detail: string;
  count: number;
}

const unique = (xs: string[]): string[] => [...new Set(xs)];

/** "a, b, c and 2 more" without ever listing more than `max` names. */
function listNames(names: string[], max = 4): string {
  const u = unique(names);
  if (u.length <= max) return u.join(', ');
  return `${u.slice(0, max).join(', ')} and ${u.length - max} more`;
}

/** Lower-case the first word of a label unless it is an acronym or contains digits (EXIF data, A4 size stay as written). */
export const lower = (s: string): string => (/^[A-Z][a-z]+(\s|$)/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

/**
 * A calm, factual list of the kinds of information found, for the "Before you share" block.
 * Categories, not findings. There is no score and no verdict: common data is not called a problem,
 * and nothing says the file is safe, clean or anonymous.
 */
export function shareNotes(findings: Finding[]): ShareNote[] {
  const notes: ShareNote[] = [];
  const of = (c: Category): Finding[] => findings.filter((f) => f.category === c);

  const location = of('location');
  const gps = location.filter((f) => f.code === 'exif.gps-position');
  const gpsOk = gps.filter((f) => f.status === 'verified');
  if (gpsOk.length > 0) {
    notes.push({
      id: 'gps',
      category: 'location',
      headline: 'An exact location',
      detail: 'The file contains GPS coordinates that can point to where it was taken.',
      count: gpsOk.length,
    });
  } else if (gps.length > 0) {
    const decodedButOdd = gps.some((f) => (f.value ?? '').includes('°'));
    notes.push({
      id: 'gps',
      category: 'location',
      headline: 'GPS fields',
      detail: decodedButOdd
        ? 'GPS coordinates are present but outside the valid range, so they are probably wrong.'
        : 'GPS fields are present but could not be decoded into a reliable position.',
      count: gps.length,
    });
  }
  const otherLocation = location.filter((f) => f.code !== 'exif.gps-position');
  if (otherLocation.length > 0) {
    notes.push({
      id: 'place',
      category: 'location',
      headline: 'Place details',
      detail: `Found: ${listNames(otherLocation.map((f) => lower(f.label)))}.`,
      count: otherLocation.length,
    });
  }

  const identity = of('identity');
  if (identity.length > 0) {
    notes.push({
      id: 'identity',
      category: 'identity',
      headline: 'Names and identifiers',
      detail: `Found: ${listNames(identity.map((f) => lower(f.label)))}.`,
      count: identity.length,
    });
  }
  const time = of('time');
  if (time.length > 0) {
    notes.push({
      id: 'time',
      category: 'time',
      headline: 'Dates and times',
      detail: `Found: ${listNames(time.map((f) => lower(f.label)))}.`,
      count: time.length,
    });
  }
  const device = of('device-software');
  if (device.length > 0) {
    notes.push({
      id: 'device',
      category: 'device-software',
      headline: 'Device and software',
      detail: `Found: ${listNames(device.map((f) => lower(f.label)))}.`,
      count: device.length,
    });
  }
  const docs = of('document-properties');
  if (docs.length > 0) {
    notes.push({
      id: 'properties',
      category: 'document-properties',
      headline: 'Descriptions and properties',
      detail: `Found: ${listNames(docs.map((f) => lower(f.label)))}.`,
      count: docs.length,
    });
  }
  const embedded = of('embedded-content');
  if (embedded.length > 0) {
    notes.push({
      id: 'embedded',
      category: 'embedded-content',
      headline: 'Embedded content',
      detail: `Found: ${listNames(embedded.map((f) => lower(f.label)))}. Embedded items may not be visible when the file is opened.`,
      count: embedded.length,
    });
  }
  const active = of('active-features');
  if (active.length > 0) {
    notes.push({
      id: 'active',
      category: 'active-features',
      headline: 'Scripts, actions or macros',
      detail: 'The file contains features that some programs can run. This tool never runs them, and their presence is not evidence of harm.',
      count: active.length,
    });
  }
  const limits = of('unsupported').filter((f) => f.code === 'limit.findings' || /\.limit$/.test(f.code));
  if (limits.length > 0) {
    notes.push({
      id: 'limits',
      category: 'unsupported',
      headline: 'A safety limit was reached',
      detail: 'Some parts of the file were not examined, or some findings were not listed, because the analysis stopped at a limit.',
      count: limits.length,
    });
  }
  const unsupported = of('unsupported').filter((f) => !limits.includes(f));
  if (unsupported.length > 0) {
    notes.push({
      id: 'unsupported',
      category: 'unsupported',
      headline: 'Parts this tool could not read',
      detail: `Present but not decoded: ${listNames(unsupported.map((f) => lower(f.label)))}.`,
      count: unsupported.length,
    });
  }
  return notes;
}

/** Plain sentence for the number of kinds found, with no ranking. */
export function noteCountText(notes: ShareNote[]): string {
  const cats = unique(notes.filter((n) => n.category !== 'unsupported').map((n) => CATEGORY_LABEL[n.category].toLowerCase()));
  return cats.length === 0 ? '' : `Kinds of information found: ${cats.join(', ')}.`;
}
