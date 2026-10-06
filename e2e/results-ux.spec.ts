import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { baseJpeg, cat, commentSegment, insertSegments } from '../fixtures/lib/jpeg';
import { chooseFile, cleanupTempFiles, expectClean, fx, openApp, tempFile, waitForResult } from './support';

test.afterEach(() => cleanupTempFiles());

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** Open every disclosure the way a person would (the lazy ones build their content on the toggle event) and let it render. */
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
const manyComments = (n: number): Buffer => Buffer.from(cat(insertSegments(baseJpeg(), Array.from({ length: n }, (_, i) => commentSegment(`synthetic comment ${i}`)))));

test.describe('"Before you share"', () => {
  test('says what a GPS photo contains and the action jumps to the copy panel with focus', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('jpeg-gps.jpg'));
    await waitForResult(page);
    const block = page.locator('#before-share');
    await expect(block.getByRole('heading', { level: 2, name: 'Before you share' })).toBeVisible();
    await expect(block.getByText('An exact location', { exact: true })).toBeVisible();
    await expect(block.getByText(/GPS coordinates that can point to where it was taken/)).toBeVisible();
    await expect(block).not.toContainText(/score|risk|safe|clean|anonymous/i);
    // The block comes before the long findings list and well before the copy panel.
    const order = await page.evaluate(() => {
      const y = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().top + window.scrollY;
      return { block: y('#before-share'), findings: y('#findings-h'), copy: y('#copy-h') };
    });
    expect(order.block).toBeLessThan(order.findings);
    expect(order.findings).toBeLessThan(order.copy);

    const before = await page.evaluate(() => window.scrollY);
    await block.getByRole('button', { name: 'Review copy options' }).click();
    await expect(page.locator('#copy-h')).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
    // the smooth scroll settles with the heading near the top of the viewport
    await expect.poll(async () => (await page.locator('#copy-h').boundingBox())!.y, { timeout: 5000 }).toBeLessThan(120);
    expect((await page.locator('#copy-h').boundingBox())!.y).toBeGreaterThanOrEqual(-1);
    // One selection only: the block holds no checkboxes.
    expect(await block.getByRole('checkbox').count()).toBe(0);
    expect(await page.getByRole('checkbox').count()).toBeGreaterThan(0);
    expectClean(w);
  });

  test('keyboard: Tab reaches the action, Enter moves focus to the canonical panel, Space toggles its options', async ({ page }) => {
    await openApp(page);
    await chooseFile(page, fx('png-kitchen-sink.png'));
    await waitForResult(page);
    const action = page.getByRole('button', { name: 'Review copy options' });
    await action.focus();
    const ring = await action.evaluate((e) => getComputedStyle(e).outlineStyle);
    expect(ring).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(page.locator('#copy-h')).toBeFocused();
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type);
    expect(focused).toBe('checkbox');
    const box = page.locator('.options input[type=checkbox]').first();
    const was = await box.isChecked();
    await page.keyboard.press('Space');
    expect(await box.isChecked()).toBe(!was);
    // category links move focus as well as scroll
    await page.locator('.category-nav a').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('h2[id^="cat-h-"]:focus')).toHaveCount(1);
  });

  test('PDF and DOCX: an honest sentence, no copy action', async ({ page }) => {
    const w = await openApp(page);
    for (const [file, kind] of [['pdf-basic.pdf', 'PDF'], ['docx-comments-tracked.docx', 'DOCX']] as const) {
      await chooseFile(page, fx(file));
      await waitForResult(page);
      const block = page.locator('#before-share');
      await expect(block).toContainText(`This tool can only inspect ${kind} files. It does not offer a modified copy.`);
      await expect(block.getByRole('button', { name: 'Review copy options' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Make experimental copy' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Clear and start over' }).first().click();
    }
    expectClean(w);
  });

  test('nothing removable: no misleading action; active content is described calmly', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('jpeg-clean.jpg'));
    await waitForResult(page);
    await expect(page.locator('#before-share')).toContainText('Nothing that this tool can remove was found, so there is no copy to make.');
    await expect(page.getByRole('button', { name: 'Review copy options' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear and start over' }).first().click();
    await chooseFile(page, fx('pdf-javascript.pdf'));
    await waitForResult(page);
    await expect(page.locator('#before-share')).toContainText('This tool never runs them, and their presence is not evidence of harm.');
    expectClean(w);
  });

  test('technical detail is folded but available; coverage is never folded', async ({ page }) => {
    await openApp(page);
    await chooseFile(page, fx('jpeg-kitchen-sink.jpg'));
    await waitForResult(page);
    const sha = page.locator('code.hash');
    await expect(sha).toBeHidden();
    await page.getByText('Technical details: extension, reported type, SHA-256').click();
    await expect(sha).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What this tool did not fully check' })).toBeVisible();
    expect(await page.locator('.coverage').evaluate((e) => !!e.closest('details'))).toBe(false);
    await expect(page.locator('.lane')).toHaveCount(0); // the map is built when opened
    await page.getByText(/Where findings sit in the file/).click();
    await expect(page.locator('.lane').first()).toBeVisible();
    // highlighting still works for rendered findings
    await page.locator('li.finding', { hasText: 'GPS position' }).hover();
    await expect(page.locator('.tick[data-active]').first()).toBeVisible();
    // evidence is built when opened
    expect(await page.locator('dl.evidence').count()).toBe(0);
    await page.locator('li.finding', { hasText: 'GPS position' }).getByText('Evidence and limits').click();
    await expect(page.locator('dl.evidence')).toHaveCount(1);
  });
});

test.describe('large result lists', () => {
  test('a bounded first screen, an accessible Show more, and every finding reachable', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, tempFile('many.jpg', manyComments(700)));
    await waitForResult(page);
    const section = page.locator('[data-category="document-properties"]');
    await expect(section.locator('li.finding')).toHaveCount(10);
    await expect(section.getByRole('status')).toHaveText('Showing 10 of 599 findings.');
    await expect(page.locator('li.finding details[open]')).toHaveCount(0);

    const more = section.getByRole('button', { name: /Show 50 more \(589 remaining\)/ });
    await expect(more).toHaveAttribute('aria-controls', 'list-document-properties');
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(section.locator('li.finding')).toHaveCount(60);
    await expect(section.getByRole('status')).toHaveText('Showing 60 of 599 findings.');
    // focus continues at the first new item
    await expect(section.locator('li.finding').nth(10)).toBeFocused();

    await section.getByRole('button', { name: 'Show all 539 remaining' }).click();
    await expect(section.locator('li.finding')).toHaveCount(599);
    await expect(section.getByRole('status')).toHaveText('Showing 599 of 599 findings.');
    await expect(section.locator('.showmore button')).toHaveCount(0);
    // page search: the last comment is now in the document
    await expect(section.getByText('synthetic comment 598')).toHaveCount(1);
    expectClean(w);
  });

  test('a closed structural category mounts nothing; the map highlights rendered items; the copy still verifies', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('jpeg-gps.jpg'));
    await waitForResult(page);
    await expect(page.locator('[data-category="structural"] li.finding')).toHaveCount(0);
    await page.locator('[data-category="structural"] summary').click();
    await expect(page.locator('[data-category="structural"] li.finding').first()).toBeVisible();
    await page.getByRole('button', { name: 'Make experimental copy' }).click();
    await expect(page.locator('.verdict[data-ok="true"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.checks li')).toHaveCount(10);
    await expect(page.locator('.checks li[data-status="fail"]')).toHaveCount(0);
    await page.locator('.manifest summary').click();
    await expect(page.locator('.manifest table')).toBeVisible();
    await expect(page.locator('.compare img')).toHaveCount(2);
    expectClean(w);
  });
});

test.describe('layout and accessibility of the changed screens', () => {
  for (const [width, height] of [
    [320, 700],
    [390, 800],
    [1440, 900],
  ] as const) {
    test(`${width}px: no sideways scroll, axe clean, with everything opened and revealed`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openApp(page);
      await chooseFile(page, tempFile('many.jpg', manyComments(700)));
      await waitForResult(page);
      await noSideScroll(page);
      await axe(page, `${width} initial`);
      await page.getByRole('button', { name: /Show 50 more/ }).click();
      await openAll(page);
      await noSideScroll(page);
      await axe(page, `${width} opened and revealed`);
      await page.getByRole('button', { name: 'Clear and start over' }).first().click();
      await chooseFile(page, fx('jpeg-kitchen-sink.jpg'));
      await waitForResult(page);
      await openAll(page);
      await noSideScroll(page);
      await axe(page, `${width} kitchen sink opened`);
      await page.getByRole('button', { name: 'Review copy options' }).click();
      await noSideScroll(page);
      await page.getByRole('button', { name: 'Make experimental copy' }).click();
      await expect(page.locator('.verdict')).toBeVisible({ timeout: 30_000 });
      await openAll(page);
      await noSideScroll(page);
      await axe(page, `${width} verification opened`);
    });
  }

  test('200% text and the equivalent of 400% zoom reflow without sideways scrolling', async ({ browser }) => {
    const context = await browser.newContext({ bypassCSP: true, viewport: { width: 640, height: 800 } });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await chooseFile(page, fx('jpeg-kitchen-sink.jpg'));
    await waitForResult(page);
    await openAll(page);
    await noSideScroll(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await noSideScroll(page);
    await page.getByRole('button', { name: 'Review copy options' }).click();
    await expect(page.locator('#copy-h')).toBeFocused();
    await noSideScroll(page);
    // no sticky or fixed element can cover content at this size
    expect(await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => ['fixed', 'sticky'].includes(getComputedStyle(e).position)).length)).toBe(0);
    await context.close();
  });

  test('reduced motion: jumps are instant, nothing animates', async ({ page }) => {
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
    await page.getByRole('button', { name: 'Review copy options' }).click();
    await expect(page.locator('#copy-h')).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as { __scrolls: string[] }).__scrolls)).toEqual(['auto']);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.scanline') ?? document.body).animationName)).toBe('none');
  });

  test('with motion allowed the jump is smooth', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
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
    await page.getByRole('button', { name: 'Review copy options' }).click();
    await expect(page.locator('#copy-h')).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as { __scrolls: string[] }).__scrolls)).toEqual(['smooth']);
  });
});

test('the guarantees did not change: only built static files are requested, nothing is stored, the CSP holds', async ({ page, context }) => {
  const w = await openApp(page);
  await chooseFile(page, fx('jpeg-kitchen-sink.jpg'));
  await waitForResult(page);
  await page.getByRole('button', { name: 'Review copy options' }).click();
  await page.getByRole('button', { name: 'Make experimental copy' }).click();
  await expect(page.locator('.verdict[data-ok="true"]')).toBeVisible({ timeout: 30_000 });
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
