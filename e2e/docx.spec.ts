import { expect, test } from '@playwright/test';
import { chooseFile, expectClean, fx, openApp, waitForResult } from './support';

test.describe('DOCX (inspection only)', () => {
  test('properties, comments and tracked changes are listed; no copy, no preview, nothing leaves the page', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('docx-comments-tracked.docx'));
    await waitForResult(page);
    await expect(page.getByText('Word document (DOCX)').first()).toBeVisible();
    await expect(page.getByText('Example Person')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tracked changes' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Comment authors' })).toBeVisible();
    await expect(page.getByText('Second Reviewer').first()).toBeVisible();
    await expect(page.getByText('Copies are not offered for DOCX files')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make experimental copy' })).toHaveCount(0);
    await expect(page.locator('img')).toHaveCount(0);
    // The comment and deleted text are never shown.
    await expect(page.locator('main')).not.toContainText('Synthetic comment one');
    await expect(page.locator('main')).not.toContainText('deleted words');
    expect(await w.cspViolations()).toEqual([]);
    expectClean(w);
  });

  test('external references and embedded parts are shown as text and never followed', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('docx-embedded.docx'));
    await waitForResult(page);
    await expect(page.getByText(/file:\/\/\/C:\/Users\/ExamplePerson\/Templates\/Fixture\.dotm/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Embedded media' })).toBeVisible();
    const hrefs = await page.locator('main a[href]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    expect(hrefs.every((h) => h?.startsWith('#'))).toBe(true);
    expectClean(w);
  });

  test('a macro project is reported as an indicator', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('docx-macro.docx'));
    await waitForResult(page);
    await expect(page.getByRole('heading', { name: 'Macros' })).toBeVisible();
    await expect(page.locator('.finding-why', { hasText: /never runs it/ })).toBeVisible();
    expectClean(w);
  });

  test('a compression bomb is flagged and inspected quickly without expanding it', async ({ page }) => {
    const w = await openApp(page);
    const t = Date.now();
    await chooseFile(page, fx('docx-zipbomb.docx'));
    await waitForResult(page);
    expect(Date.now() - t).toBeLessThan(8000);
    await expect(page.getByText(/compression bomb/)).toBeVisible();
    expectClean(w);
  });

  test('hostile properties render as text', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('docx-hostile-metadata.docx'));
    await waitForResult(page);
    await expect(page.locator('main')).toContainText('<script>');
    await expect(page.locator('main script')).toHaveCount(0);
    await expect(page.locator('main img[src="x"]')).toHaveCount(0);
    expectClean(w);
  });

  test('a plain ZIP and a damaged package are not guessed', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('zip-not-docx.zip'));
    await waitForResult(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This format is not supported');
    await expect(page.getByText(/ZIP-based container/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Choose another file' }).click();
    await chooseFile(page, fx('docx-truncated.docx'));
    await waitForResult(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This format is not supported');
    expectClean(w);
  });

  test('a DOCX with a wrong extension is reported as a mismatch', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('docx-fake-extension.png'));
    await waitForResult(page);
    await expect(page.getByText('File name or declared type does not match the content')).toBeVisible();
    expectClean(w);
  });
});
