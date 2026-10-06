import AxeBuilder from '@axe-core/playwright';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { analyseBytes } from '../src/core/analyze';
import { baseJpeg, cat, commentSegment, insertSegments } from '../fixtures/lib/jpeg';
import { buildPng, chunk } from '../fixtures/lib/png';
import { chooseFile, chooseWhatToRemove, cleanupTempFiles, expectClean, fx, openApp, openReport, tempFile, waitForResult } from './support';

test.afterEach(() => cleanupTempFiles());

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const measurements: Record<string, number> = {};
test.afterAll(() => console.log('LAYOUT', JSON.stringify(measurements)));

/** Open every native disclosure the way a person would (lazy ones build on the toggle event) and let it render. */
async function openAll(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        document.querySelectorAll('details').forEach((d) => (d.open = true));
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
async function axe(page: Page, label: string): Promise<void> {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), label).toEqual([]);
}
async function noSideScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}
const height = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollHeight);
const manyComments = (n: number): Buffer => Buffer.from(cat(insertSegments(baseJpeg(), Array.from({ length: n }, (_, i) => commentSegment(`synthetic comment ${i}`)))));
const analyse = async (bytes: Uint8Array) => {
  const out = await analyseBytes(bytes, { name: 'x', type: '' });
  if (!out.supported) throw new Error('unsupported');
  return out.report;
};

test.describe('simple result and the one-click copy', () => {
  test('GPS photo: the simple answer first, report closed, one click creates the copy and the result is compact', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('jpeg-gps.jpg'));
    await waitForResult(page);
    const block = page.locator('#before-share');
    await expect(block.getByRole('heading', { level: 2, name: 'Before you share' })).toBeVisible();
    await expect(block.getByText('An exact location', { exact: true })).toBeVisible();
    await expect(block.getByText(/GPS coordinates that can point to where it was taken/)).toBeVisible();
    await expect(block).toContainText(/Common data is not automatically a problem, and other hidden information may remain/);
    await expect(block).toContainText(/5 areas were only partly checked or not checked/);
    await expect(block).toContainText(/your original is not changed/i);
    await expect(block).not.toContainText(/score|risk|safe|clean|anonymous/i);
    await expect(page.locator('li.finding')).toHaveCount(0);
    await expect(page.locator('code.hash')).toHaveCount(0);
    await expect(page.locator('#report-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.original-preview img')).toBeVisible();
    measurements.nodesSimple = await page.evaluate(() => document.querySelectorAll('*').length);
    expect(measurements.nodesSimple).toBeLessThan(400);
    await expect(page.locator('#copy-section')).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);

    await block.getByRole('button', { name: 'Create experimental copy' }).click();
    await expect(page.locator('.verdict[data-ok="true"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#verify-h')).toBeFocused();
    const verification = page.locator('#verification');
    await expect(verification.locator('.compare img')).toHaveCount(2);
    await expect(verification.getByRole('button', { name: 'Download experimental copy' })).toBeVisible();
    await expect(verification.getByText(/^No longer detected \(\d+\)/)).toBeVisible();
    await expect(verification.getByText(/^Still detected \(\d+\)/)).toBeVisible();
    await expect(verification).toContainText(/Open and check this copy before sharing it, and keep your original/);
    await expect(verification).toContainText('Other hidden information may remain');
    await expect(page.locator('.checks li')).toHaveCount(0);
    await expect(verification.locator('table')).toHaveCount(0);
    await page.getByText(/All 10 verification checks/).click();
    await expect(page.locator('.checks li')).toHaveCount(10);
    await expect(page.locator('.checks li[data-status="fail"]')).toHaveCount(0);
    await expect(verification.getByRole('table', { name: 'Original and experimental copy compared' })).toBeVisible();
    await page.locator('.manifest summary').click();
    await expect(page.locator('.manifest table')).toBeVisible();
    expectClean(w);
  });

  test('"Choose what to remove" reveals the single canonical panel, moves focus there, and the choice drives the copy', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('jpeg-kitchen-sink.jpg'));
    await waitForResult(page);
    const choose = page.getByRole('button', { name: 'Choose what to remove' });
    await expect(choose).toHaveAttribute('aria-expanded', 'false');
    await choose.click();
    await expect(page.locator('#copy-h')).toBeFocused();
    await expect(choose).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Always kept')).toBeVisible();
    await expect(page.getByLabel(/^EXIF data/)).toBeChecked();
    await expect(page.getByLabel(/^Data after the end of the image/)).not.toBeChecked();
    await page.getByLabel(/^Data after the end of the image/).check();
    await expect(page.locator('#before-share')).toContainText(/Selected for removal: .*data after the end of the image/i);
    await page.getByRole('button', { name: 'Create copy with these choices' }).click();
    await expect(page.locator('.verdict[data-ok="true"]')).toBeVisible({ timeout: 30_000 });
    const d = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download experimental copy' }).click();
    const copy = await analyse(readFileSync((await (await d).path())!));
    expect(copy.findings.some((f) => f.code.includes('trailing'))).toBe(false);
    await page.getByRole('button', { name: 'Change what to remove' }).click();
    await expect(page.locator('#copy-h')).toBeFocused();
    await expect(page.locator('.verdict')).toHaveCount(0);
    expectClean(w);
  });

  test('the full technical report is not built until opened; opening moves focus; bounded lists and Show more inside', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, tempFile('many.jpg', manyComments(700)));
    await waitForResult(page);
    expect(await page.evaluate(() => document.querySelectorAll('*').length)).toBeLessThan(450);
    await expect(page.locator('#report-body')).toHaveCount(0);
    await expect(page.locator('li.finding')).toHaveCount(0);
    await page.locator('#before-share').getByRole('button', { name: 'View full technical report' }).click();
    await expect(page.locator('#report-h')).toBeFocused();
    const section = page.locator('section[data-category="document-properties"]');
    await expect(section.locator('li.finding')).toHaveCount(10);
    await expect(section.getByRole('status')).toContainText(/Showing 10 of \d+ findings/);
    await section.getByRole('button', { name: /^Show \d+ more/ }).click();
    expect(await section.locator('li.finding').count()).toBeGreaterThan(10);
    await section.getByRole('button', { name: /^Show all/ }).click();
    await expect(section.locator('li.finding')).toHaveCount(599);
    await page.locator('#report-toggle').click();
    await expect(page.locator('#report-body')).toHaveCount(0);
    await expect(page.locator('li.finding')).toHaveCount(0);
    await expect(page.locator('#report-toggle')).toBeFocused();
    await page.locator('#report-toggle').click();
    await expect(page.locator('section[data-category="document-properties"] li.finding')).toHaveCount(10);
    expectClean(w);
  });

  test('the coverage summary is always on the simple view and leads to the detailed coverage', async ({ page }) => {
    await openApp(page);
    await chooseFile(page, fx('jpeg-kitchen-sink.jpg'));
    await waitForResult(page);
    await expect(page.locator('.coverage-line')).toContainText('only partly checked or not checked');
    await page.getByRole('button', { name: 'See what was not checked' }).click();
    await expect(page.locator('#coverage-h')).toBeFocused();
  });

  test('PDF and DOCX: summary and honest sentence, no copy action, preview optional, report available', async ({ page }) => {
    const w = await openApp(page);
    for (const [file, kind] of [['pdf-basic.pdf', 'PDF'], ['docx-comments-tracked.docx', 'DOCX']] as const) {
      await chooseFile(page, fx(file));
      await waitForResult(page);
      const block = page.locator('#before-share');
      await expect(block).toContainText(`This tool can only inspect ${kind} files. It does not offer a modified copy.`);
      await expect(page.getByRole('button', { name: 'Create experimental copy' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Choose what to remove' })).toHaveCount(0);
      await expect(page.locator('#report-body')).toHaveCount(0);
      if (kind === 'PDF') await expect(page.locator('.pdf-preview img')).toHaveCount(0);
      else await expect(page.getByText(/No preview is shown for Word documents/)).toBeVisible();
      await block.getByRole('button', { name: 'View full technical report' }).click();
      await expect(page.locator('#report-body')).toBeVisible();
      await page.getByRole('button', { name: 'Clear and start over' }).first().click();
    }
    expectClean(w);
  });

  test('nothing removable: no copy button, the report stays available, the file is not called clean', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('jpeg-clean.jpg'));
    await waitForResult(page);
    const block = page.locator('#before-share');
    await expect(block).toContainText('Nothing that this tool can remove was found, so there is no copy to make. Other hidden information may still be present.');
    await expect(block.locator('.recommend')).not.toContainText(/clean|safe/i);
    await expect(page.getByRole('button', { name: 'Create experimental copy' })).toHaveCount(0);
    await expect(block.getByRole('button', { name: 'View full technical report' })).toBeVisible();
    expectClean(w);
  });

  test('cancelling a copy stops it; a late result never replaces the screen', async ({ page }) => {
    const w = await openApp(page);
    const png = Buffer.from(buildPng({ before: [chunk('tEXt', Buffer.from('Comment\0large payload')), chunk('zzZz', randomBytes(30 * 1024 * 1024))] }));
    await chooseFile(page, tempFile('large.png', png));
    await waitForResult(page);
    await page.getByRole('button', { name: 'Create experimental copy' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Create experimental copy' })).toBeEnabled();
    await page.waitForTimeout(2500);
    await expect(page.locator('.verdict')).toHaveCount(0);
    await page.getByRole('button', { name: 'Create experimental copy' }).click();
    await expect(page.locator('.verdict[data-ok="true"]')).toBeVisible({ timeout: 40_000 });
    expectClean(w);
  });

  test('keyboard: Tab reaches the actions, Enter creates the copy and focus lands on the verification', async ({ page }) => {
    await openApp(page);
    await chooseFile(page, fx('png-text.png'));
    await waitForResult(page);
    const create = page.getByRole('button', { name: 'Create experimental copy' });
    await create.focus();
    expect(await create.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Choose what to remove' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#copy-h')).toBeFocused();
    await create.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#verify-h')).toBeFocused({ timeout: 30_000 });
    await page.locator('#report-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#report-h')).toBeFocused();
    await page.locator('#report-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#report-toggle')).toBeFocused();
  });
});

test.describe('how much shorter the page is', () => {
  test('jpeg-gps.jpg at 1440 x 900 and 390 x 844', async ({ page }) => {
    for (const [name, w, h] of [['desktop', 1440, 900], ['mobile', 390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await openApp(page);
      await chooseFile(page, fx('jpeg-gps.jpg'));
      await waitForResult(page);
      await page.waitForTimeout(300);
      measurements[`${name}HeightSimple`] = await height(page);
      await page.getByRole('button', { name: 'Create experimental copy' }).click();
      await expect(page.locator('.verdict')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(300);
      measurements[`${name}HeightAfterCopy`] = await height(page);
      await page.locator('#report-toggle').click();
      await page.waitForTimeout(300);
      measurements[`${name}HeightReportOpen`] = await height(page);
      await page.getByRole('button', { name: 'Clear and start over' }).first().click();
    }
    // Before this change the same file measured about 4,970 px (desktop) and 7,170 px after the copy.
    expect(measurements.desktopHeightSimple).toBeLessThan(2000);
    expect(measurements.desktopHeightAfterCopy).toBeLessThan(3000);
    expect(measurements.mobileHeightSimple).toBeLessThan(2800);
    expect(measurements.desktopHeightReportOpen).toBeGreaterThan(measurements.desktopHeightAfterCopy!);
  });
});

test.describe('layout and accessibility of the new flow', () => {
  for (const [width, vh] of [
    [320, 700],
    [390, 800],
    [1440, 900],
  ] as const) {
    test(`${width}px: no sideways scroll and axe clean in every state`, async ({ page }) => {
      await page.setViewportSize({ width, height: vh });
      await openApp(page);
      await chooseFile(page, fx('jpeg-kitchen-sink.jpg'));
      await waitForResult(page);
      await noSideScroll(page);
      await axe(page, `${width} simple`);
      await chooseWhatToRemove(page);
      await noSideScroll(page);
      await axe(page, `${width} options`);
      await page.getByRole('button', { name: 'Create copy with these choices' }).click();
      await expect(page.locator('.verdict')).toBeVisible({ timeout: 30_000 });
      await noSideScroll(page);
      await axe(page, `${width} copy result`);
      await openAll(page);
      await noSideScroll(page);
      await axe(page, `${width} copy result, everything opened`);
      await page.locator('#report-toggle').click();
      await openAll(page);
      await noSideScroll(page);
      await axe(page, `${width} report open`);
      await page.getByRole('button', { name: 'Clear and start over' }).first().click();
      await chooseFile(page, tempFile('many.jpg', manyComments(700)));
      await waitForResult(page);
      await page.locator('#report-toggle').click();
      await page.getByRole('button', { name: /^Show \d+ more/ }).first().click();
      await openAll(page);
      await noSideScroll(page);
      await axe(page, `${width} large report revealed`);
      await page.getByRole('button', { name: 'Clear and start over' }).first().click();
      for (const f of ['pdf-basic.pdf', 'docx-comments-tracked.docx', 'jpeg-clean.jpg']) {
        await chooseFile(page, fx(f));
        await waitForResult(page);
        await noSideScroll(page);
        await axe(page, `${width} ${f}`);
        await page.getByRole('button', { name: 'Clear and start over' }).first().click();
      }
    });
  }

  test('200% text and 320 px reflow without sideways scrolling; nothing is sticky', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 800 });
    await openApp(page);
    await page.evaluate(() => document.documentElement.style.setProperty('font-size', '200%', 'important'));
    await chooseFile(page, fx('jpeg-kitchen-sink.jpg'));
    await waitForResult(page);
    await noSideScroll(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await noSideScroll(page);
    await chooseWhatToRemove(page);
    await expect(page.locator('#copy-h')).toBeFocused();
    await page.getByRole('button', { name: 'Create copy with these choices' }).click();
    await expect(page.locator('.verdict')).toBeVisible({ timeout: 30_000 });
    await page.locator('#report-toggle').click();
    await openAll(page);
    await noSideScroll(page);
    expect(await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => ['fixed', 'sticky'].includes(getComputedStyle(e).position)).length)).toBe(0);
  });

  test('reduced motion: the jump to the options is instant', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      const w = window as unknown as { __scrolls: string[] };
      w.__scrolls = [];
      const orig = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
        w.__scrolls.push(typeof arg === 'object' && arg ? String(arg.behavior) : 'none');
        return orig.call(this, arg as ScrollIntoViewOptions);
      };
    });
    await openApp(page);
    await chooseFile(page, fx('jpeg-gps.jpg'));
    await waitForResult(page);
    await page.getByRole('button', { name: 'Choose what to remove' }).click();
    await expect(page.locator('#copy-h')).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as { __scrolls: string[] }).__scrolls)).toEqual(['auto']);
  });

  test('status is never colour alone inside the report', async ({ page }) => {
    await openApp(page);
    await chooseFile(page, fx('jpeg-kitchen-sink.jpg'));
    await waitForResult(page);
    await openReport(page);
    const statuses = await page.locator('.status').evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''));
    expect(statuses.length).toBeGreaterThan(5);
    for (const s of statuses) expect(s).toMatch(/Verified|Inferred|Suspicious|Not supported|Unavailable/);
  });
});

test('the guarantees did not change: nothing is stored and the CSP holds', async ({ page, context }) => {
  const w = await openApp(page);
  await chooseFile(page, fx('jpeg-kitchen-sink.jpg'));
  await waitForResult(page);
  await page.getByRole('button', { name: 'Create experimental copy' }).click();
  await expect(page.locator('.verdict[data-ok="true"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('#report-toggle').click();
  const state = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    cookie: document.cookie,
    caches: 'caches' in window ? (await caches.keys()).length : 0,
  }));
  expect(state).toEqual({ local: 0, session: 0, cookie: '', caches: 0 });
  expect(await context.cookies()).toEqual([]);
  expect(await w.cspViolations()).toEqual([]);
  expectClean(w);
});
