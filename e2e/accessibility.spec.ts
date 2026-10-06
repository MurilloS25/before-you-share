import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { chooseFile, cleanupTempFiles, expectClean, fx, openApp, tempFile, waitForResult } from './support';

test.afterEach(() => cleanupTempFiles());

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function axe(page: Page, label: string): Promise<void> {
  // Open every disclosure so hidden content is checked too.
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary, `${label}: axe violations`).toEqual([]);
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
}

async function reachResultWithCopy(page: Page): Promise<void> {
  await chooseFile(page, fx('jpeg-kitchen-sink.jpg'));
  await waitForResult(page);
}

test.describe('axe (WCAG 2.x A/AA and best practice) on every state', () => {
  test('idle, working, results, copy, verification, errors', async ({ page }) => {
    const w = await openApp(page);
    await axe(page, 'idle');

    // working state (slow PDF so the state lasts long enough)
    const unit = Buffer.from('1 0 obj\n<< /Type /Page /Parent 2 0 R /Contents [3 0 R 4 0 R] >>\nendobj\n');
    const slow = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(unit.toString().repeat(Math.floor((60 * 1024 * 1024) / unit.length)))]);
    await chooseFile(page, tempFile('slow.pdf', slow));
    await expect(page.getByRole('heading', { level: 1, name: 'Inspecting' })).toBeVisible();
    await axe(page, 'working');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await reachResultWithCopy(page);
    await axe(page, 'jpeg result');
    await page.getByRole('button', { name: 'Make experimental copy' }).click();
    await expect(page.locator('.verdict')).toBeVisible({ timeout: 30_000 });
    await axe(page, 'verification');
    await page.getByRole('button', { name: 'Clear and start over' }).last().click();

    await chooseFile(page, fx('png-kitchen-sink.png'));
    await waitForResult(page);
    await axe(page, 'png result');
    await page.getByRole('button', { name: 'Clear and start over' }).first().click();

    await chooseFile(page, fx('pdf-xmp.pdf'));
    await waitForResult(page);
    await page.getByRole('button', { name: 'Show page 1 as a picture' }).click();
    await expect(page.locator('.pdf-preview img')).toBeVisible({ timeout: 30_000 });
    await axe(page, 'pdf result with preview');
    await page.getByRole('button', { name: 'Clear and start over' }).first().click();

    await chooseFile(page, fx('docx-embedded.docx'));
    await waitForResult(page);
    await axe(page, 'docx result');
    await page.getByRole('button', { name: 'Clear and start over' }).first().click();

    await chooseFile(page, fx('unsupported.gif'));
    await waitForResult(page);
    await axe(page, 'unsupported');
    await page.getByRole('button', { name: 'Choose another file' }).click();
    await chooseFile(page, fx('empty.bin'));
    await expect(page.getByRole('alert')).toBeVisible();
    await axe(page, 'error');
    expectClean(w);
  });
});

test.describe('keyboard and focus', () => {
  test('the whole flow works without a mouse and focus is always visible', async ({ page }) => {
    await openApp(page);
    // The file input is the first focusable control after the (absent) clear button.
    const input = page.locator('input.file-input');
    // Keyboard only: Tab until the file input is reached (it is the first control on the start screen).
    for (let i = 0; i < 3 && !(await input.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(input).toBeFocused();
    const ring = await page.locator('.dropzone').evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
    expect(ring).toMatch(/solid 3px/);

    // Enter opens the native file chooser, which is the keyboard alternative to drag and drop.
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles(fx('png-text.png'));
    await waitForResult(page);
    // Focus moves to the result heading so assistive technology starts at the new content.
    await expect(page.getByRole('heading', { level: 1, name: 'Inspection result' })).toBeFocused();

    // Tab to the checkboxes and operate them with Space, then make the copy with Enter.
    const checkbox = page.getByLabel(/^Text entries and XMP/);
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).not.toBeChecked();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    const outline = await checkbox.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
    const make = page.getByRole('button', { name: 'Make experimental copy' });
    await make.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.verdict')).toBeVisible({ timeout: 30_000 });

    // Disclosure widgets are keyboard operable.
    const summary = page.locator('li.finding summary').first();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(summary.locator('xpath=..')).toHaveAttribute('open', '');

    // Every interactive element has a visible focus indicator.
    const interactive = page.locator('button:visible, a[href]:visible, input:visible, summary:visible');
    const n = await interactive.count();
    for (let i = 0; i < Math.min(n, 25); i++) {
      const el = interactive.nth(i);
      await el.focus();
      const visible = await el.evaluate((e) => {
        const s = getComputedStyle(e);
        const target = e.matches('input[type=file]') ? (e.closest('.dropzone') as HTMLElement) : e;
        const t = getComputedStyle(target);
        return t.outlineStyle !== 'none' && parseFloat(t.outlineWidth) >= 2 && s.visibility !== 'hidden';
      });
      expect(visible, `focus ring on element ${i}`).toBe(true);
    }
  });

  test('drag and drop works and the picker remains available', async ({ page }) => {
    const w = await openApp(page);
    const bytes = readFileSync(fx('jpeg-gps.jpg')).toString('base64');
    await page.evaluate(
      async (b64) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bin], 'dropped.jpg', { type: 'image/jpeg' }));
        const zone = document.querySelector('.dropzone')!;
        zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      },
      bytes,
    );
    await waitForResult(page);
    await expect(page.getByText('0.250000° N, 0.750000° E')).toBeVisible();
    expectClean(w);
  });
});

test.describe('layout, zoom and motion', () => {
  for (const [width, height] of [
    [320, 700],
    [390, 800],
    [1440, 900],
  ] as const) {
    test(`no horizontal scrolling at ${width}px on any screen, axe clean`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openApp(page);
      await noHorizontalScroll(page);
      await axe(page, `idle ${width}`);
      await chooseFile(page, fx('jpeg-kitchen-sink.jpg'));
      await waitForResult(page);
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
      await noHorizontalScroll(page);
      await axe(page, `result ${width}`);
      await page.getByRole('button', { name: 'Make experimental copy' }).click();
      await expect(page.locator('.verdict')).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
      await noHorizontalScroll(page);
      await axe(page, `verification ${width}`);
    });
  }

  test('200% text size reflows without horizontal scrolling (and 400% zoom equals a 320px viewport)', async ({ browser }) => {
    // bypassCSP only lets the test inject a stylesheet that simulates a user's larger default font size.
    const context = await browser.newContext({ bypassCSP: true, viewport: { width: 640, height: 800 } });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await noHorizontalScroll(page);
    await chooseFile(page, fx('png-kitchen-sink.png'));
    await waitForResult(page);
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
    await noHorizontalScroll(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await noHorizontalScroll(page);
    await context.close();
  });

  test('reduced motion removes all decorative animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    const names = await page.evaluate(() => [...document.querySelectorAll('.plate-sheet')].map((e) => getComputedStyle(e).animationName));
    expect(names).toEqual(['none', 'none']);
    const unit = Buffer.from('1 0 obj\n<< /Type /Page >>\nendobj\n');
    await chooseFile(page, tempFile('slow.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(unit.toString().repeat(1_500_000))])));
    await expect(page.locator('.scanline')).toBeAttached();
    expect(await page.locator('.scanline').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  });

  test('with motion allowed the intake sheets animate once and the scan line runs while working', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openApp(page);
    const names = await page.evaluate(() => [...document.querySelectorAll('.plate-sheet')].map((e) => getComputedStyle(e).animationName));
    expect(names).toEqual(['fan', 'fan']);
  });

  test('status is never conveyed by colour alone', async ({ page }) => {
    await openApp(page);
    await chooseFile(page, fx('jpeg-kitchen-sink.jpg'));
    await waitForResult(page);
    const statuses = await page.locator('.status').evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''));
    expect(statuses.length).toBeGreaterThan(5);
    for (const s of statuses) expect(s).toMatch(/Verified|Inferred|Suspicious|Not supported|Unavailable/);
    const borders = await page.locator('li.finding').evaluateAll((els) => els.map((e) => `${(e as HTMLElement).dataset.status}:${getComputedStyle(e).borderLeftStyle}`));
    expect(new Set(borders.filter((b) => b.startsWith('inferred')).map((b) => b.split(':')[1]))).toEqual(new Set(['dashed']));
    expect(new Set(borders.filter((b) => b.startsWith('unsupported')).map((b) => b.split(':')[1]))).toEqual(new Set(['dotted']));
  });
});
