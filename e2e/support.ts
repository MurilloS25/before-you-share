import { expect, type Page } from '@playwright/test';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const fx = (name: string): string => join(process.cwd(), 'fixtures', 'generated', name);

/** Names of the static files the production build contains. These are the only network resources the app may load. */
export function builtAssets(): Set<string> {
  return new Set(readdirSync(join(process.cwd(), 'dist', 'assets')));
}

export interface Watch {
  requests: Array<{ method: string; url: string; hasBody: boolean }>;
  consoleProblems: string[];
  pageErrors: string[];
  dialogs: string[];
  cspViolations: () => Promise<string[]>;
  mark(): number;
  /** Request count when the page finished loading; everything after it is "processing". */
  loadMark: number;
  since(mark: number): Watch['requests'];
  /** Requests since `mark` that are not a GET of a built static asset or a blob: URL. */
  unexpected(mark: number): string[];
}

/**
 * Records requests, console problems, dialogs, page errors and CSP violations. The app's own built static
 * files (and blob: object URLs created in the page) are the only network activity allowed after load.
 */
export async function watch(page: Page): Promise<Watch> {
  const requests: Watch['requests'] = [];
  const consoleProblems: string[] = [];
  const pageErrors: string[] = [];
  const dialogs: string[] = [];
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    const w = window as unknown as { __urls: { created: number; revoked: number } };
    w.__urls = { created: 0, revoked: 0 };
    const c = URL.createObjectURL.bind(URL);
    const r = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (o: Blob | MediaSource) => {
      w.__urls.created++;
      return c(o);
    };
    URL.revokeObjectURL = (u: string) => {
      w.__urls.revoked++;
      r(u);
    };
  });
  page.on('request', (r) => requests.push({ method: r.method(), url: r.url(), hasBody: r.postData() !== null }));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleProblems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  const assets = builtAssets();
  return {
    requests,
    consoleProblems,
    pageErrors,
    dialogs,
    cspViolations: async () => (await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)) ?? [],
    loadMark: 0,
    mark: () => requests.length,
    since: (m) => requests.slice(m),
    unexpected: (m) =>
      requests
        .slice(m)
        .filter((r) => {
          if (r.url.startsWith('blob:')) return false;
          const u = new URL(r.url);
          const isAsset = r.method === 'GET' && !r.hasBody && u.origin === 'http://127.0.0.1:4173' && u.pathname.startsWith('/assets/') && assets.has(u.pathname.slice('/assets/'.length));
          return !isAsset;
        })
        .map((r) => `${r.method} ${r.url}`),
  };
}

export async function openApp(page: Page): Promise<Watch> {
  const w = await watch(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('See what a file may reveal before you share it.');
  await page.waitForLoadState('networkidle');
  w.loadMark = w.mark();
  return w;
}

const tempDirs: string[] = [];
/** Synthetic large files are written to a temporary folder (Playwright limits in-memory buffers to 50 MB). Call cleanupTempFiles() when done. */
export function tempFile(name: string, bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'bys-e2e-'));
  tempDirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}
export function cleanupTempFiles(): void {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export async function chooseFile(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await page.locator('input.file-input').setInputFiles(file);
}

export const RESULT_HEADING = /Inspection result|This format is not supported|This file is|The file could not|Something went wrong|A safety limit|The job took too long|This could not be done/;

export async function waitForResult(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: RESULT_HEADING })).toBeVisible({ timeout: 30_000 });
}

export async function urlCounts(page: Page): Promise<{ created: number; revoked: number }> {
  return page.evaluate(() => (window as unknown as { __urls: { created: number; revoked: number } }).__urls);
}

export function expectClean(w: Watch, mark = w.loadMark): void {
  expect(w.consoleProblems).toEqual([]);
  expect(w.pageErrors).toEqual([]);
  expect(w.dialogs).toEqual([]);
  expect(w.unexpected(mark)).toEqual([]);
}

/** Open the technical report (closed by default) and wait for it to be built. */
export async function openReport(page: Page): Promise<void> {
  const toggle = page.locator('#report-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.locator('#report-body')).toBeVisible();
}

/** Open the (closed) copy options panel. */
export async function chooseWhatToRemove(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Choose what to remove' }).click();
  await expect(page.locator('#copy-section')).toBeVisible();
}
