import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyseBytes, type AnalysisOutcome } from '../src/core/analyze';
import type { AnalysisReport, Finding } from '../src/core/types';

export const fixturePath = (name: string): string => join(__dirname, '..', 'fixtures', 'generated', name);
export const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(fixturePath(name)));

export async function analyseFixture(name: string, type = ''): Promise<AnalysisReport> {
  const out = await analyseBytes(fixture(name), { name, type });
  if (!out.supported) throw new Error(`${name} unexpectedly unsupported`);
  return out.report;
}
export async function outcomeOf(name: string, type = ''): Promise<AnalysisOutcome> {
  return analyseBytes(fixture(name), { name, type });
}
export const byCode = (r: AnalysisReport, code: string): Finding[] => r.findings.filter((f) => f.code === code);
export const valueOf = (r: AnalysisReport, code: string): string | null => byCode(r, code)[0]?.value ?? null;
