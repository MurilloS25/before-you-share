import { displayText } from './bytes';
import { LIMITS } from './limits';
import { CATALOG } from './explain';
import type {
  Category,
  Confidence,
  CoverageItem,
  EvidenceLocation,
  EvidenceStatus,
  Finding,
  TransformationSupport,
} from './types';

export interface AddOptions {
  value?: string | null;
  source: string;
  location?: EvidenceLocation;
  status?: EvidenceStatus;
  confidence?: Confidence;
  label?: string;
  category?: Category;
  /** Overrides the catalogue group (use null to detach a finding from any removal option). */
  group?: string | null;
  transformation?: TransformationSupport;
  limitations?: string[];
}

/** Collects findings and coverage for one analysis, applying the catalogue and the finding cap. */
export class FindingSink {
  readonly findings: Finding[] = [];
  readonly coverage: CoverageItem[] = [];
  private counter = 0;
  private capped = false;

  add(code: string, o: AddOptions): Finding | null {
    const entry = CATALOG[code];
    if (!entry) throw new Error(`Unknown finding code ${code}`);
    // Structural findings (limits, truncation, trailing data) are never crowded out by a long list of
    // ordinary findings, but the list still has a hard ceiling.
    const essential = /^(jpeg|png|pdf)\.(limit|truncated|invalid-segment|invalid|trailing-data|order|malformed)$|^image\./.test(code);
    const ceiling = essential ? LIMITS.maxFindings + 100 : LIMITS.maxFindings;
    if (this.findings.length >= ceiling) {
      if (!this.capped) {
        this.capped = true;
        this.findings.push({
          id: `limit#${++this.counter}`,
          code: 'limit.findings',
          category: 'unsupported',
          label: 'Further findings were not listed',
          value: `The list stops at ${LIMITS.maxFindings} findings.`,
          source: 'Finding limit',
          location: { kind: 'none' },
          status: 'unsupported',
          confidence: 'high',
          privacyExplanation: 'The file contains more items than this tool is willing to list.',
          removable: false,
          transformation: 'unsupported',
          limitations: [],
        });
      }
      return null;
    }
    const group = o.group === null ? undefined : (o.group ?? entry.group);
    const transformation: TransformationSupport =
      o.transformation ?? (group ? 'removable' : (entry.transformation ?? 'unsupported'));
    const f: Finding = {
      id: `${code}#${++this.counter}`,
      code,
      category: o.category ?? entry.category,
      label: o.label ?? entry.label,
      value: o.value === undefined || o.value === null ? null : displayText(o.value, LIMITS.maxDisplayChars),
      source: o.source,
      location: o.location ?? { kind: 'none' },
      status: o.status ?? 'verified',
      confidence: o.confidence ?? 'high',
      privacyExplanation: entry.privacy,
      removable: transformation === 'removable',
      transformation,
      limitations: [...(entry.limitations ?? []), ...(o.limitations ?? [])],
    };
    if (group) f.group = group;
    this.findings.push(f);
    return f;
  }

  cover(area: string, state: CoverageItem['state'], note: string): void {
    this.coverage.push({ area, state, note });
  }
}
