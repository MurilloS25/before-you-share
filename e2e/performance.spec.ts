import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { baseJpeg, cat, commentSegment, insertSegments } from '../fixtures/lib/jpeg';
import { buildPng, chunk } from '../fixtures/lib/png';
import { chooseFile, cleanupTempFiles, expectClean, fx, openApp, tempFile, waitForResult } from './support';

test.afterEach(() => cleanupTempFiles());

/**
 * Installs a probe on the page's main thread: the longest gap between 16 ms timer ticks and the longest Long Task
 * (any task over 50 ms). Reading them gives the worst blocking seen since installation.
 */
async function installLagProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __lag: { max: number; last: number; id: number; long: number; obs: PerformanceObserver | null } };
    w.__lag = { max: 0, last: performance.now(), id: 0, long: 0, obs: null };
    w.__lag.id = window.setInterval(() => {
      const now = performance.now();
      w.__lag.max = Math.max(w.__lag.max, now - w.__lag.last - 16);
      w.__lag.last = now;
    }, 16);
    try {
      w.__lag.obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__lag.long = Math.max(w.__lag.long, e.duration);
      });
      w.__lag.obs.observe({ type: 'longtask', buffered: false });
    } catch {
      /* Long Tasks unsupported: the timer probe still applies */
    }
  });
}
async function readLag(page: Page): Promise<{ gap: number; longTask: number }> {
  return page.evaluate(() => {
    const w = window as unknown as { __lag: { max: number; id: number; long: number; obs: PerformanceObserver | null } };
    clearInterval(w.__lag.id);
    w.__lag.obs?.disconnect();
    return { gap: Math.round(w.__lag.max), longTask: Math.round(w.__lag.long) };
  });
}

const measurements: Record<string, number> = {};
test.afterAll(() => {
  // Printed so the numbers in the final report are the ones actually measured.
  console.log('PERF', JSON.stringify(measurements));
});

test('main thread stays responsive while a slow file is inspected', async ({ page }) => {
  const w = await openApp(page);
  const unit = Buffer.from('1 0 obj\n<< /Type /Page /Parent 2 0 R /Contents [3 0 R 4 0 R] >>\nendobj\n');
  const slow = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(unit.toString().repeat(Math.floor((50 * 1024 * 1024) / unit.length)))]);
  await installLagProbe(page);
  const t0 = Date.now();
  await chooseFile(page, tempFile('slow.pdf', slow));
  await expect(page.getByRole('heading', { level: 1, name: 'Inspecting' })).toBeVisible();
  await page.waitForTimeout(2500);
  // The UI answers a click while the worker is busy.
  const t1 = Date.now();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('See what a file may reveal before you share it.');
  measurements.cancelLatencyMs = Date.now() - t1;
  measurements.slowPdfSecondsUntilCancel = Math.round((Date.now() - t0) / 100) / 10;
  const lag = await readLag(page);
  measurements.mainThreadMaxLagMs = lag.gap;
  expect(lag.gap).toBeLessThan(250);
  expect(measurements.cancelLatencyMs).toBeLessThan(1500);
  expectClean(w);
});

test('worker timing for a 40 MiB PNG within the limits', async ({ page }) => {
  await openApp(page);
  // 40 MiB PNG whose unknown chunk is incompressible: every chunk is length-checked and CRC-verified.
  const png = buildPng({ before: [chunk('zzZz', randomBytes(40 * 1024 * 1024))] });
  const t = Date.now();
  await chooseFile(page, tempFile('big.png', Buffer.from(png)));
  await waitForResult(page);
  measurements.png40MiBInspectMs = Date.now() - t;
  expect(measurements.png40MiBInspectMs).toBeLessThan(15_000);
  await expect(page.getByRole('heading', { name: 'Unrecognised chunk' })).toBeVisible();
});

/**
 * Presentation phase of the largest result the parser can produce: 40 MiB of 64 KiB comment segments reach the
 * 600-finding cap. The file is read and parsed in the worker; what is measured here is what the page does with the
 * result (building the screen), as the longest main-thread blocking from choosing the file until the result has
 * been shown and has settled. The limit is deliberately tight: it was 1,500 ms before the list was bounded.
 */
test('presenting a 600-finding result keeps the main thread free (250 ms budget)', async ({ page }) => {
  await openApp(page);
  const segs = Array.from({ length: 620 }, () => commentSegment('x'.repeat(65000)));
  const jpeg = Buffer.from(cat(insertSegments(baseJpeg(), segs)));
  const file = tempFile('big.jpg', jpeg);
  await installLagProbe(page);
  const t = Date.now();
  await chooseFile(page, file);
  await waitForResult(page);
  measurements.jpeg40MiBInspectMs = Date.now() - t;
  expect(measurements.jpeg40MiBInspectMs).toBeLessThan(15_000);
  await expect(page.getByRole('heading', { name: 'Further findings were not listed' })).toBeVisible();
  // let layout, image decoding and effects settle; this is a wait for the browser, not a way to hide the render
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await page.waitForTimeout(400);
  const lag = await readLag(page);
  measurements.presentationMaxGapMs = lag.gap;
  measurements.presentationLongTaskMs = lag.longTask;
  expect(lag.gap).toBeLessThan(250);
  expect(lag.longTask).toBeLessThan(250);

  // The screen is bounded, and everything the parser kept is still reachable.
  const nodes = await page.evaluate(() => document.querySelectorAll('*').length);
  const rendered = await page.locator('li.finding').count();
  measurements.presentationDomNodes = nodes;
  measurements.presentationRenderedFindings = rendered;
  expect(rendered).toBeLessThan(40);
  expect(nodes).toBeLessThan(1500);
  await expect(page.getByText(/Showing 10 of 599 findings/)).toBeVisible();

  // Revealing everything is an explicit user action; it is measured too and must stay interactive.
  await installLagProbe(page);
  await page.getByRole('button', { name: /Show all 589 remaining/ }).click();
  await expect(page.locator('li.finding')).toHaveCount(599 + (rendered - 10));
  const reveal = await readLag(page);
  measurements.revealAllMaxGapMs = reveal.gap;
  measurements.revealAllLongTaskMs = reveal.longTask;
  expect(reveal.longTask).toBeLessThan(1000);
});

test('typical files finish quickly', async ({ page }) => {
  await openApp(page);
  for (const f of ['jpeg-kitchen-sink.jpg', 'png-kitchen-sink.png', 'pdf-xmp.pdf']) {
    const t = Date.now();
    await chooseFile(page, fx(f));
    await waitForResult(page);
    measurements[`${f}Ms`] = Date.now() - t;
    expect(Date.now() - t).toBeLessThan(5000);
    await page.getByRole('button', { name: 'Clear and start over' }).first().click();
  }
});

test('copy and verification of a large PNG completes and releases memory on reset', async ({ page }) => {
  await openApp(page);
  const client = await page.context().newCDPSession(page);
  await client.send('HeapProfiler.enable');
  await client.send('HeapProfiler.collectGarbage');
  const before = (await client.send('Runtime.getHeapUsage')).usedSize;
  const png = buildPng({ before: [chunk('tEXt', Buffer.from('Comment\0large payload')), chunk('zzZz', randomBytes(30 * 1024 * 1024))] });
  const file = tempFile('large.png', Buffer.from(png));
  for (let i = 0; i < 3; i++) {
    await chooseFile(page, file);
    await waitForResult(page);
    const t = Date.now();
    await page.getByLabel(/^Unrecognised ancillary chunks/).check();
    await page.getByRole('button', { name: 'Make experimental copy' }).click();
    await expect(page.locator('.verdict')).toBeVisible({ timeout: 40_000 });
    measurements.copy30MiBPngMs = Date.now() - t;
    await page.getByRole('button', { name: 'Clear and start over' }).last().click();
  }
  await client.send('HeapProfiler.collectGarbage');
  const after = (await client.send('Runtime.getHeapUsage')).usedSize;
  measurements.mainThreadHeapGrowthMiB = Math.round((after - before) / 1048576);
  // File bytes live in the worker and are never copied into the main thread's heap.
  expect(after - before).toBeLessThan(40 * 1024 * 1024);
});
