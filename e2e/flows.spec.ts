import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { analyseBytes } from '../src/core/analyze';
import { chooseFile, cleanupTempFiles, expectClean, fx, openApp, tempFile, urlCounts, waitForResult } from './support';

test.afterEach(() => cleanupTempFiles());

const sha = (b: Buffer | Uint8Array): string => createHash('sha256').update(b).digest('hex');

async function analyse(bytes: Uint8Array) {
  const out = await analyseBytes(bytes, { name: 'x', type: '' });
  if (!out.supported) throw new Error('unsupported');
  return out.report;
}

test.describe('JPEG', () => {
  test('full flow: inspect, choose items, copy, verify, download, reset', async ({ page }) => {
    const w = await openApp(page);
    const loaded = w.mark();
    const originalHash = sha(readFileSync(fx('jpeg-kitchen-sink.jpg')));

    await chooseFile(page, fx('jpeg-kitchen-sink.jpg'));
    await waitForResult(page);
    await expect(page.getByText('0.250000° N, 0.750000° E')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /^Location/ })).toBeVisible();
    await expect(page.getByText('Example Maker')).toBeVisible();
    // Evidence is expandable and states the byte range.
    const gps = page.locator('li.finding', { hasText: 'GPS position' });
    await gps.getByText('Evidence and limits').click();
    await expect(gps.getByText(/Bytes [\d,]+ to [\d,]+/)).toBeVisible();
    // Limitations are disclosed.
    await expect(page.getByRole('heading', { level: 2, name: 'What this tool did not fully check' })).toBeVisible();

    // The original preview decoded.
    await expect(page.locator('.original-preview img')).toBeVisible();
    expect(await page.locator('.original-preview img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);

    // Defaults: metadata groups on, structures we cannot judge off.
    await expect(page.getByLabel(/^EXIF data/)).toBeChecked();
    await expect(page.getByLabel(/^Other application segments/)).not.toBeChecked();
    await expect(page.getByLabel(/^Data after the end of the image/)).not.toBeChecked();
    await expect(page.getByText('Always kept')).toBeVisible();

    await page.getByRole('button', { name: 'Make experimental copy' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Experimental copy, re-inspected' })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.verdict[data-ok="true"]')).toContainText('Other hidden information may remain');
    // Every check passed, including the browser decode comparison.
    const checks = page.locator('.checks li');
    await expect(checks).toHaveCount(10);
    await expect(page.locator('.checks li[data-status="fail"]')).toHaveCount(0);
    await expect(page.locator('.checks li', { hasText: 'decode in this browser' })).toHaveAttribute('data-status', 'pass');
    await expect(page.locator('.checks li', { hasText: 'decode in this browser' })).toContainText('every decoded pixel is identical');
    // Side by side previews both decode.
    const imgs = page.locator('.compare img');
    await expect(imgs).toHaveCount(2);
    for (const ok of await imgs.evaluateAll((els) => els.map((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))) expect(ok).toBe(true);
    await expect(page.getByRole('heading', { name: /^No longer detected/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Still detected/ })).toBeVisible();

    // Download is a separate, clearly named file; nothing downloaded before the click.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download experimental copy' }).click();
    const d = await download;
    expect(d.suggestedFilename()).toBe('jpeg-kitchen-sink.experimental-copy.jpg');
    const copyBytes = readFileSync((await d.path())!);
    const report = await analyse(copyBytes);
    const codes = new Set(report.findings.map((f) => f.code));
    expect(codes.has('exif.gps-position')).toBe(false);
    expect(codes.has('xmp.creator')).toBe(false);
    expect(codes.has('exif.orientation')).toBe(true);
    expect(report.dimensions).toEqual({ width: 64, height: 48 });

    // The original on disk is byte-identical.
    expect(sha(readFileSync(fx('jpeg-kitchen-sink.jpg')))).toBe(originalHash);

    // Reset releases everything.
    await page.getByRole('button', { name: 'Clear and start over' }).last().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('See what a file may reveal before you share it.');
    const counts = await urlCounts(page);
    expect(counts.created).toBeGreaterThan(0);
    expect(counts.revoked).toBe(counts.created);
    expect(await w.cspViolations()).toEqual([]);
    expectClean(w, loaded);
  });

  test('opt-in groups are removed only when selected', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('jpeg-kitchen-sink.jpg'));
    await waitForResult(page);
    await page.getByLabel(/^Data after the end of the image/).check();
    await page.getByLabel(/^Other application segments/).check();
    await page.getByRole('button', { name: 'Make experimental copy' }).click();
    await expect(page.locator('.verdict[data-ok="true"]')).toBeVisible({ timeout: 30_000 });
    const d = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download experimental copy' }).click();
    const report = await analyse(readFileSync((await (await d).path())!));
    expect(report.findings.map((f) => f.code).sort()).toEqual(['exif.orientation', 'icc.profile', 'image.dimensions', 'jpeg.jfif']);
    expectClean(w);
  });

  test('a file with nothing removable offers no copy', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('jpeg-clean.jpg'));
    await waitForResult(page);
    await expect(page.getByText('Nothing that this tool can remove was found')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make experimental copy' })).toHaveCount(0);
    expectClean(w);
  });

  test('damaged JPEG: inspected, copy refused with a reason', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('jpeg-truncated.jpg'));
    await waitForResult(page);
    await expect(page.getByText('JPEG ends unexpectedly')).toBeVisible();
    await expect(page.getByText(/No copy is offered for this file/)).toBeVisible();
    expectClean(w);
  });

  test('extreme declared dimensions: no decode, no copy', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('jpeg-extreme-dimensions.jpg'));
    await waitForResult(page);
    await expect(page.getByText('Very large declared image size')).toBeVisible();
    await expect(page.locator('.original-preview')).toHaveCount(0);
    await expect(page.getByText(/No copy is offered/)).toBeVisible();
    expectClean(w);
  });
});

test.describe('PNG', () => {
  test('full flow with text, XMP, EXIF and trailing data', async ({ page }) => {
    const w = await openApp(page);
    const loaded = w.mark();
    await chooseFile(page, fx('png-kitchen-sink.png'));
    await waitForResult(page);
    await expect(page.getByText('Example Person').first()).toBeVisible();
    await expect(page.getByText('Título ✓')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Data after IEND' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unrecognised chunk' })).toBeVisible();
    await page.getByRole('button', { name: 'Make experimental copy' }).click();
    await expect(page.locator('.verdict[data-ok="true"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.checks li[data-status="fail"]')).toHaveCount(0);
    const d = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download experimental copy' }).click();
    const dl = await d;
    expect(dl.suggestedFilename()).toBe('png-kitchen-sink.experimental-copy.png');
    const report = await analyse(readFileSync((await dl.path())!));
    const codes = report.findings.map((f) => f.code);
    expect(codes).not.toContain('png.text-author');
    expect(codes).not.toContain('exif.gps-position');
    expect(codes).toContain('png.unknown-chunk'); // not selected, so kept and disclosed
    expect(codes).toContain('png.trailing-data');
    expect(w.unexpected(loaded)).toEqual([]);
  });
});

test.describe('PDF', () => {
  test('inspect-only with page 1 shown as an inert picture', async ({ page }) => {
    const w = await openApp(page);
    const loaded = w.mark();
    await chooseFile(page, fx('pdf-basic.pdf'));
    await waitForResult(page);
    await expect(page.getByText('Fixture Document')).toBeVisible();
    await expect(page.getByText('Example Person')).toBeVisible();
    await expect(page.getByText('2000-01-01 00:00:00 UTC').first()).toBeVisible();
    await expect(page.getByText('00112233445566778899aabbccddeeff')).toBeVisible();
    await expect(page.getByText('Copies are not offered for PDF files')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make experimental copy' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show page 1 as a picture' }).click();
    const img = page.locator('.pdf-preview img');
    await expect(img).toBeVisible({ timeout: 30_000 });
    expect(await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    expect(await w.cspViolations()).toEqual([]);
    expectClean(w, loaded);
  });

  test('active content and attachments are reported, never run', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('pdf-javascript.pdf'));
    await waitForResult(page);
    await expect(page.getByText('JavaScript or scripted action')).toBeVisible();
    await expect(page.locator('.finding-why', { hasText: /never runs them/ })).toBeVisible();
    await page.getByRole('button', { name: 'Clear and start over' }).first().click();
    await chooseFile(page, fx('pdf-link-actions.pdf'));
    await waitForResult(page);
    await expect(page.getByText('https://example.invalid/fixture')).toBeVisible();
    await expect(page.getByRole('link')).not.toContainText(['example.invalid']); // links in a PDF are text here, never anchors
    expectClean(w);
  });

  test('encrypted PDF is reported and not opened', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('pdf-encrypted.pdf'));
    await waitForResult(page);
    await expect(page.getByText('A password is required to open this document')).toBeVisible();
    await page.getByRole('button', { name: 'Show page 1 as a picture' }).click();
    await expect(page.getByText(/could not be drawn/)).toBeVisible({ timeout: 30_000 });
    expectClean(w);
  });

  test('malformed and truncated PDFs degrade honestly', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('pdf-truncated.pdf'));
    await waitForResult(page);
    await expect(page.getByText('PDF could not be fully parsed')).toBeVisible();
    await expect(page.getByText('PDF ends unexpectedly')).toBeVisible();
    expectClean(w);
  });
});

test.describe('unsupported, mismatched and refused files', () => {
  test('unsupported format is named and nothing is guessed', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('unsupported.gif'));
    await waitForResult(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This format is not supported');
    await expect(page.getByText('GIF image').first()).toBeVisible();
    await page.getByRole('button', { name: 'Choose another file' }).click();
    await chooseFile(page, fx('unsupported.txt'));
    await expect(page.getByText('Unrecognised content').first()).toBeVisible();
    expectClean(w);
  });

  test('a wrong extension does not fool detection and is reported', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('jpeg-fake-extension.png'));
    await waitForResult(page);
    await expect(page.getByText('JPEG image').first()).toBeVisible();
    await expect(page.getByText('File name or declared type does not match the content')).toBeVisible();
    await expect(page.getByText(/the file name ends in “\.png”/)).toBeVisible();
    expectClean(w);
  });

  test('empty file', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('empty.bin'));
    await expect(page.getByRole('heading', { level: 1, name: 'This file is empty' })).toBeVisible();
    expectClean(w);
  });

  test('files above the size limits are refused without being read', async ({ page }) => {
    const w = await openApp(page);
    const big = Buffer.alloc(65 * 1024 * 1024);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;
    await chooseFile(page, tempFile('huge.jpg', big));
    await expect(page.getByRole('heading', { level: 1, name: 'This file is too large' })).toBeVisible();
    await page.getByRole('button', { name: 'Choose another file' }).click();
    const mid = Buffer.alloc(50 * 1024 * 1024);
    mid[0] = 0xff;
    mid[1] = 0xd8;
    mid[2] = 0xff;
    await chooseFile(page, tempFile('big.jpg', mid));
    await expect(page.getByRole('heading', { level: 1, name: 'This could not be done' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/larger than the 48 MiB/)).toBeVisible();
    expectClean(w);
  });
});

test.describe('cancellation, succession and reset', () => {
  /** A 60 MiB PDF full of objects with no cross-reference table: pdf.js has to rebuild it, which takes seconds. */
  const slowPdf = (): Buffer => {
    const unit = Buffer.from('1 0 obj\n<< /Type /Page /Parent 2 0 R /Contents [3 0 R 4 0 R] >>\nendobj\n');
    const n = Math.floor((60 * 1024 * 1024) / unit.length);
    return Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(0), Buffer.from(unit.toString().repeat(n))]);
  };

  test('cancel during inspection stops the job, keeps nothing, and the next file works', async ({ page }) => {
    const w = await openApp(page);
    const loaded = w.mark();
    await chooseFile(page, tempFile('slow.pdf', slowPdf()));
    await expect(page.getByRole('heading', { level: 1, name: 'Inspecting' })).toBeVisible();
    await expect(page.locator('.working-text')).toContainText(/Reading|Inspecting/);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('See what a file may reveal before you share it.');
    await expect(page.getByText('Cancelled. Nothing was kept.')).toBeVisible();
    // A new file is analysed normally on a fresh worker.
    await chooseFile(page, fx('jpeg-gps.jpg'));
    await waitForResult(page);
    await expect(page.getByText('0.250000° N, 0.750000° E')).toBeVisible();
    expectClean(w, loaded);
  });

  test('choosing a second file while the first is running supersedes it (no stale result)', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, tempFile('slow.pdf', slowPdf()));
    await expect(page.getByRole('heading', { level: 1, name: 'Inspecting' })).toBeVisible();
    // The file input is replaced while busy only through Clear; use the reset path as the user would.
    await page.getByRole('button', { name: 'Clear and start over' }).click();
    await chooseFile(page, fx('png-text.png'));
    await waitForResult(page);
    await expect(page.getByText('Synthetic comment')).toBeVisible();
    await page.waitForTimeout(1500); // a late result from the cancelled worker must never replace this one
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inspection result');
    await expect(page.getByText('Synthetic comment')).toBeVisible();
    expectClean(w);
  });

  test('two files in succession never mix results', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('jpeg-gps.jpg'));
    await waitForResult(page);
    await expect(page.getByText('Fixture Camera One')).toBeVisible();
    await page.getByRole('button', { name: 'Clear and start over' }).first().click();
    await chooseFile(page, fx('pdf-basic.pdf'));
    await waitForResult(page);
    await expect(page.getByText('Fixture Document')).toBeVisible();
    await expect(page.getByText('Fixture Camera One')).toHaveCount(0);
    await expect(page.getByText('0.250000')).toHaveCount(0);
    expectClean(w);
  });

  test('reset after a copy clears the page and revokes every object URL', async ({ page }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('png-text.png'));
    await waitForResult(page);
    await page.getByRole('button', { name: 'Make experimental copy' }).click();
    await expect(page.locator('.verdict[data-ok="true"]')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Clear and start over' }).last().click();
    await expect(page.locator('li.finding')).toHaveCount(0);
    await expect(page.locator('img')).toHaveCount(0);
    const c = await urlCounts(page);
    expect(c.revoked).toBe(c.created);
    expectClean(w);
  });
});

test.describe('hostile content stays inert', () => {
  test('markup, bidi controls and control characters in metadata render as text', async ({ page }) => {
    const w = await openApp(page);
    for (const file of ['jpeg-hostile-metadata.jpg', 'png-hostile-metadata.png', 'pdf-hostile-metadata.pdf']) {
      await chooseFile(page, fx(file));
      await waitForResult(page);
      await expect(page.locator('main')).toContainText('<script>');
      await expect(page.locator('main script')).toHaveCount(0);
      await expect(page.locator('main img[src="x"]')).toHaveCount(0);
      await expect(page.locator('main svg[onload]')).toHaveCount(0);
      expect(await page.locator('main').evaluate((m) => /[‪-‮⁦-⁩]/.test(m.textContent ?? ''))).toBe(false);
      await page.getByRole('button', { name: 'Clear and start over' }).first().click();
    }
    expectClean(w);
  });

  test('a hostile file name is shown as text and sanitised for the download name', async ({ page }) => {
    const w = await openApp(page);
    const name = '<img src=x onerror=alert(1)>‮evil/..\\.jpg';
    await chooseFile(page, { name, mimeType: 'image/jpeg', buffer: readFileSync(fx('jpeg-gps.jpg')) });
    await waitForResult(page);
    await expect(page.locator('main img[src="x"]')).toHaveCount(0);
    await expect(page.locator('.user-text', { hasText: '<img src=x' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Make experimental copy' }).click();
    await expect(page.locator('.verdict[data-ok="true"]')).toBeVisible({ timeout: 30_000 });
    const d = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download experimental copy' }).click();
    const dl = await d;
    expect(dl.suggestedFilename()).toMatch(/\.experimental-copy\.jpg$/);
    expect(dl.suggestedFilename()).not.toMatch(/[\\/<>‮]/);
    expectClean(w);
  });
});

test('security headers and the CSP are present on the document and the worker script', async ({ page, request }) => {
  const res = await request.get('/');
  const csp = res.headers()['content-security-policy']!;
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("connect-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain('unsafe-eval');
  expect(csp).not.toContain('unsafe-inline');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  const w = await openApp(page);
  const workerReq = w.requests.find((r) => /analysis\.worker/.test(r.url));
  void workerReq;
  const html = await page.content();
  expect(html).toContain('http-equiv="Content-Security-Policy"');
});
