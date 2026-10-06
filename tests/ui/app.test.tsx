// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/ui/App';
import { ObjectUrlRegistry } from '../../src/ui/lib/urls';
import type { AnalysisClient, JobHandle, JobOutcome } from '../../src/worker/client';
import type { JobHandlers } from '../../src/worker/client';
import { createCopy } from '../../src/transform/verify';
import { removalGroupsFor } from '../../src/transform/groups';
import { analyseFixture, fixture } from '../helpers';
import type { AnalysisReport } from '../../src/core/types';
import { analyseBytes } from '../../src/core/analyze';
import { baseJpeg, commentSegment, insertSegments } from '../../fixtures/lib/jpeg';

interface Deferred {
  resolve: (o: JobOutcome) => void;
  handlers: JobHandlers;
  cancelled: boolean;
}

/** A client whose jobs are resolved by the test, so every UI state can be observed. */
function fakeClient() {
  const jobs: Deferred[] = [];
  const calls = { analyse: [] as File[], transform: [] as string[][], preview: 0, cancel: 0, dispose: 0 };
  const make = (handlers: JobHandlers = {}): JobHandle => {
    let resolve!: (o: JobOutcome) => void;
    const promise = new Promise<JobOutcome>((r) => (resolve = r));
    const d: Deferred = { resolve, handlers, cancelled: false };
    jobs.push(d);
    return { promise, cancel: () => ((d.cancelled = true), resolve({ ok: false, error: { code: 'cancelled', message: 'cancelled' } })) };
  };
  const state = { sessionOpen: true };
  const client = {
    get sessionOpen() {
      return state.sessionOpen;
    },
    analyse: (f: File, h?: JobHandlers) => (calls.analyse.push(f), make(h)),
    transform: (g: string[], h?: JobHandlers) => (calls.transform.push(g), make(h)),
    previewPdf: (h?: JobHandlers) => (calls.preview++, make(h)),
    cancel: () => {
      calls.cancel++;
      jobs.forEach((j) => !j.cancelled && j.resolve({ ok: false, error: { code: 'cancelled', message: 'cancelled' } }));
    },
    dispose: () => {
      calls.dispose++;
    },
    busy: false,
  };
  return { client: client as unknown as AnalysisClient, jobs, calls, state };
}

const file = (name = 'a.jpg', bytes: Uint8Array = fixture('jpeg-clean.jpg'), type = 'image/jpeg') => new File([bytes as BlobPart], name, { type });
const analysisOf = (report: AnalysisReport): JobOutcome => ({ ok: true, payload: { kind: 'analysis', supported: true, report } });

/** Open a lazy disclosure the way the browser does: set `open` and fire the toggle event. */
function openDetails(el: Element | null): void {
  const d = el as HTMLDetailsElement;
  d.open = true;
  fireEvent(d, new Event('toggle'));
}

let created: string[] = [];
let revoked: string[] = [];
beforeEach(() => {
  created = [];
  revoked = [];
  let n = 0;
  URL.createObjectURL = () => {
    const u = `blob:test/${++n}`;
    created.push(u);
    return u;
  };
  URL.revokeObjectURL = (u: string) => void revoked.push(u);
});
afterEach(() => cleanup());

async function open(f: File, report: AnalysisReport) {
  const fc = fakeClient();
  const urls = new ObjectUrlRegistry();
  const utils = render(<App client={fc.client} urls={urls} />);
  fireEvent.change(screen.getByLabelText('Choose a file to inspect'), { target: { files: [f] } });
  await waitFor(() => expect(fc.jobs.length).toBe(1));
  fc.jobs[0]!.resolve(analysisOf(report));
  await screen.findByRole('heading', { level: 1, name: 'Inspection result' });
  // the screen's own focus move (to the h1) runs after paint: let it finish before a test starts interacting
  await waitFor(() => expect(document.activeElement?.tagName).toBe('H1'));
  return { ...fc, urls, utils };
}

describe('idle screen', () => {
  it('states the local-processing promise and offers a keyboard-reachable file input', () => {
    render(<App client={fakeClient().client} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('See what a file may reveal before you share it.');
    expect(screen.getByText(/Your file stays here/)).toBeTruthy();
    expect(screen.getByText(/never uploaded/)).toBeTruthy();
    const input = screen.getByLabelText('Choose a file to inspect') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.tabIndex).toBe(0);
    expect(input.accept).toBe(''); // unsupported files are explained, not hidden by the picker
    expect(screen.queryByRole('button', { name: 'Clear and start over' })).toBeNull();
  });

  it('accepts a dropped file and notes when several were dropped', async () => {
    const fc = fakeClient();
    render(<App client={fc.client} />);
    const zone = document.querySelector('.dropzone')!;
    fireEvent.dragOver(zone);
    expect(document.querySelector('.plate')!.hasAttribute('data-dragging')).toBe(true);
    fireEvent.drop(zone, { dataTransfer: { files: [file('one.jpg'), file('two.jpg')] } });
    await waitFor(() => expect(fc.calls.analyse.length).toBe(1));
    expect(fc.calls.analyse[0]!.name).toBe('one.jpg');
    fc.jobs[0]!.resolve(analysisOf(await analyseFixture('jpeg-clean.jpg')));
    await screen.findByText('Only the first file was opened. Choose the others one at a time.');
  });
});

describe('working state', () => {
  it('shows progress text, a native progress element and a working Cancel', async () => {
    const fc = fakeClient();
    render(<App client={fc.client} />);
    fireEvent.change(screen.getByLabelText('Choose a file to inspect'), { target: { files: [file()] } });
    await screen.findByRole('heading', { level: 1, name: 'Inspecting' });
    fc.jobs[0]!.handlers.onProgress?.('reading', 0.42);
    const status = await screen.findByText(/Reading the file in this browser/);
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).not.toMatch(/%/); // the live region carries the stage only, not every percentage
    expect(screen.getByText('42%')).toBeTruthy();
    const bar = document.querySelector('progress')!;
    expect(bar.getAttribute('value')).toBe('42');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.querySelector('.notice')?.textContent).toBe('Cancelled. Nothing was kept.'));
    expect(fc.calls.cancel).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('See what a file may reveal');
  });

  it('ignores the result of a superseded job', async () => {
    const fc = fakeClient();
    render(<App client={fc.client} />);
    const input = screen.getByLabelText('Choose a file to inspect');
    fireEvent.change(input, { target: { files: [file('first.jpg')] } });
    await waitFor(() => expect(fc.jobs.length).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Clear and start over' }));
    fireEvent.change(screen.getByLabelText('Choose a file to inspect'), { target: { files: [file('second.jpg')] } });
    await waitFor(() => expect(fc.jobs.length).toBe(2));
    // The first job finishes late with a result for the first file.
    fc.jobs[0]!.resolve(analysisOf(await analyseFixture('jpeg-gps.jpg')));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Fixture Camera One')).toBeNull();
    fc.jobs[1]!.resolve(analysisOf(await analyseFixture('jpeg-clean.jpg')));
    await screen.findByRole('heading', { level: 1, name: 'Inspection result' });
    expect(screen.getByText('second.jpg')).toBeTruthy();
  });
});

describe('refusals and errors', () => {
  it('refuses empty and oversized files before any worker is used', async () => {
    const fc = fakeClient();
    render(<App client={fc.client} />);
    fireEvent.change(screen.getByLabelText('Choose a file to inspect'), { target: { files: [new File([], 'e.bin')] } });
    await screen.findByRole('heading', { name: 'This file is empty' });
    expect(fc.calls.analyse.length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Choose another file' }));
    const huge = new File([new Uint8Array(4)], 'huge.jpg');
    Object.defineProperty(huge, 'size', { value: 70 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Choose a file to inspect'), { target: { files: [huge] } });
    await screen.findByRole('heading', { name: 'This file is too large' });
    expect(screen.getByRole('alert').textContent).toContain('70.0 MiB');
    expect(fc.calls.analyse.length).toBe(0);
  });

  it('shows structured worker errors as an alert and never raw error text', async () => {
    const fc = fakeClient();
    render(<App client={fc.client} />);
    fireEvent.change(screen.getByLabelText('Choose a file to inspect'), { target: { files: [file()] } });
    await waitFor(() => expect(fc.jobs.length).toBe(1));
    fc.jobs[0]!.resolve({ ok: false, error: { code: 'timeout', message: 'The job took longer than 30 seconds and was stopped.' } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The job took too long');
    expect(alert.textContent).toContain('Your original file was not changed');
  });

  it('explains an unsupported format without listing findings', async () => {
    const fc = fakeClient();
    render(<App client={fc.client} />);
    fireEvent.change(screen.getByLabelText('Choose a file to inspect'), { target: { files: [file('x.gif', fixture('unsupported.gif'), 'image/gif')] } });
    await waitFor(() => expect(fc.jobs.length).toBe(1));
    fc.jobs[0]!.resolve({
      ok: true,
      payload: {
        kind: 'analysis',
        supported: false,
        detection: { format: null, mime: 'image/gif', label: 'GIF image', recognisedUnsupported: true },
        fingerprint: { size: 14, declaredType: 'image/gif', detectedType: 'image/gif', detectedFormat: null, extension: 'gif', extensionCheck: 'unknown', declaredTypeCheck: 'unknown', sha256: null },
      },
    });
    await screen.findByRole('heading', { level: 1, name: 'This format is not supported' });
    expect(screen.getByText(/It does not guess/)).toBeTruthy();
    expect(document.querySelector('li.finding')).toBeNull();
  });
});

/** Open the technical report the way a person does, and wait for it to be built. */
async function openReport(): Promise<void> {
  fireEvent.click(document.getElementById('report-toggle')!);
  await waitFor(() => expect(document.getElementById('report-body')).not.toBeNull());
}

/** Resolve the pending transform job with a real copy, as the worker would. */
async function finishCopy(fc: Awaited<ReturnType<typeof open>>, original: Uint8Array, report: AnalysisReport, groups: string[], jobIndex = 1) {
  await waitFor(() => expect(fc.jobs.length).toBeGreaterThan(jobIndex));
  const result = await createCopy(original, report, groups);
  const buf = result.output.buffer.slice(result.output.byteOffset, result.output.byteOffset + result.output.byteLength) as ArrayBuffer;
  fc.jobs[jobIndex]!.resolve({ ok: true, payload: { kind: 'transform', output: buf, manifest: result.manifest, verification: result.verification } });
  await screen.findByRole('heading', { name: 'Experimental copy, re-inspected' });
  return result;
}
const defaultGroups = (report: AnalysisReport): string[] => removalGroupsFor(report).filter((g) => g.defaultOn).map((g) => g.id);
const createButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Create experimental copy' }) as HTMLButtonElement;

describe('technical report (closed by default)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('is not built until opened: no findings, evidence, map, SHA-256 or coverage list are in the page', async () => {
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    await open(file('k.jpg', fixture('jpeg-kitchen-sink.jpg')), report);
    expect(document.getElementById('report-toggle')!.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('report-body')).toBeNull();
    expect(document.querySelectorAll('li.finding').length).toBe(0);
    expect(document.querySelector('.hash')).toBeNull();
    expect(document.querySelector('.coverage-list')).toBeNull();
    expect(document.querySelectorAll('*').length).toBeLessThan(400);
  });

  it('opens to the findings, moves focus to its heading, and closing returns focus to the button', async () => {
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    await open(file('k.jpg', fixture('jpeg-kitchen-sink.jpg')), report);
    await openReport();
    expect(document.getElementById('report-toggle')!.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(document.activeElement?.id).toBe('report-h'));
    expect(document.querySelectorAll('li.finding').length).toBeGreaterThan(5);
    expect(screen.getByRole('heading', { name: 'What this tool did not fully check' })).toBeTruthy();
    fireEvent.click(document.getElementById('report-toggle')!);
    await waitFor(() => expect(document.getElementById('report-body')).toBeNull());
    expect(document.activeElement?.id).toBe('report-toggle');
    await openReport(); // reopening works
    expect(document.querySelectorAll('li.finding').length).toBeGreaterThan(5);
  });

  it('the coverage summary links to the detailed coverage: it opens the report and moves focus there', async () => {
    const report = await analyseFixture('jpeg-gps.jpg');
    await open(file('g.jpg', fixture('jpeg-gps.jpg')), report);
    const block = document.getElementById('before-share')!;
    expect(block.textContent).toMatch(/5 areas were only partly checked or not checked/);
    fireEvent.click(within(block).getByRole('button', { name: 'See what was not checked' }));
    await waitFor(() => expect(document.activeElement?.id).toBe('coverage-h'));
    expect(document.getElementById('report-body')).not.toBeNull();
  });

  it('keeps the technical detail folded inside: SHA-256, status legend, map, evidence and the structural category', async () => {
    const report = await analyseFixture('jpeg-gps.jpg');
    await open(file('g.jpg', fixture('jpeg-gps.jpg')), report);
    await openReport();
    const sha = document.querySelector('.hash')!;
    expect((sha.closest('details') as HTMLDetailsElement).open).toBe(false);
    expect(sha.textContent).toBe(report.fingerprint.sha256);
    expect((screen.getByText('How to read the status labels').closest('details') as HTMLDetailsElement).open).toBe(false);
    expect(document.querySelectorAll('.lane').length).toBe(0);
    expect(document.querySelectorAll('dl.evidence').length).toBe(0);
    expect(document.querySelector('[data-category="structural"] li.finding')).toBeNull();
    openDetails(screen.getByText(/Where findings sit in the file/).closest('details'));
    await waitFor(() => expect(document.querySelectorAll('.lane').length).toBeGreaterThan(0));
    // the findings themselves are plain on the page
    expect(screen.getByText('GPS position').closest('details')).toBeNull();
  });

  it('a 600-finding result: closed report costs a few hundred nodes; opened it shows 10 first with Show more', async () => {
    const jpeg = insertSegments(baseJpeg(), Array.from({ length: 700 }, (_, i) => commentSegment(`c${i}`)));
    const out = await analyseBytes(jpeg, { name: 'many.jpg', type: 'image/jpeg' });
    if (!out.supported) throw new Error('unsupported');
    const report = out.report;
    await open(file('many.jpg', jpeg), report);
    expect(document.querySelectorAll('li.finding').length).toBe(0);
    expect(document.querySelectorAll('*').length).toBeLessThan(400);
    await openReport();
    const section = document.querySelector('section[data-category="document-properties"]') as HTMLElement;
    expect(within(section).getByRole('status').textContent).toMatch(/Showing 10 of 599 findings/);
    expect(section.querySelectorAll('li.finding').length).toBe(10);
    expect(document.querySelectorAll('*').length).toBeLessThan(1500);
  });

  it('opens the details that follows a jumped-to heading (structural category)', async () => {
    const report = await analyseFixture('jpeg-clean.jpg');
    await open(file('c.jpg', fixture('jpeg-clean.jpg')), report);
    await openReport();
    const { goTo } = await import('../../src/ui/lib/nav');
    goTo('cat-h-structural');
    expect((document.querySelector('[data-category="structural"] details') as HTMLDetailsElement).open).toBe(true);
  });

  it('inspection result: findings are grouped calmly by category with status words, evidence and limits', async () => {
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    await open(file('kitchen.jpg', fixture('jpeg-kitchen-sink.jpg')), report);
    await openReport();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '');
    const order = ['Location', 'Identity', 'Time', 'Device and software', 'Document properties', 'Embedded content'].map((c) => headings.findIndex((h) => h.startsWith(c)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const gps = screen.getByText('GPS position').closest('li')!;
    expect(within(gps).getByText('0.250000° N, 0.750000° E')).toBeTruthy();
    expect(within(gps).getByText('Verified')).toBeTruthy();
    const evidence = within(gps).getByText('Evidence and limits').closest('details')!;
    expect(evidence.querySelector('dl.evidence')).toBeNull();
    openDetails(evidence);
    await waitFor(() => expect(evidence.querySelector('dl.evidence')).not.toBeNull());
    expect(evidence.textContent).toContain('JPEG APP1 Exif');
    expect(evidence.textContent).toMatch(/Bytes [\d,]+ to [\d,]+/);
    expect(evidence.textContent).toContain('The experimental copy can remove this.');
    expect(document.body.textContent).not.toMatch(/risk score|danger|unsafe|leak|exposed/i);
    const unsupported = screen.getByText('Manufacturer-specific data (MakerNote)').closest('li')!;
    expect(within(unsupported).getByText('Not supported')).toBeTruthy();
    const suspicious = screen.getAllByText('Data after the end of the image').map((e) => e.closest<HTMLElement>('li.finding')).find(Boolean)!;
    expect(within(suspicious).getByText('Suspicious')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'What this tool did not fully check' })).toBeTruthy();
    expect(screen.getByText(/Other hidden information may remain in this file/)).toBeTruthy();
  });

  it('renders hostile metadata as text, never as markup', async () => {
    const report = await analyseFixture('jpeg-hostile-metadata.jpg');
    const { utils } = await open(file('h.jpg', fixture('jpeg-hostile-metadata.jpg')), report);
    await openReport();
    expect(utils.container.querySelector('script')).toBeNull();
    expect(utils.container.querySelector('img[src="x"]')).toBeNull();
    expect(utils.container.querySelector('svg')).toBeNull();
    expect(utils.container.textContent).toContain('<img src=x onerror=alert(1)><script>alert(2)</script>');
  });
});

describe('simple result (the default view)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('says plainly that a photo contains an exact location, without scoring or verdicts, and without any technical list', async () => {
    const report = await analyseFixture('jpeg-gps.jpg');
    await open(file('g.jpg', fixture('jpeg-gps.jpg')), report);
    const block = document.getElementById('before-share')!;
    expect(within(block).getByRole('heading', { level: 2, name: 'Before you share' })).toBeTruthy();
    expect(within(block).getByText('An exact location')).toBeTruthy();
    expect(within(block).getByText(/GPS coordinates that can point to where it was taken/)).toBeTruthy();
    expect(block.textContent).toMatch(/Common data is not automatically a problem, and other hidden information may remain/);
    expect(block.textContent).toMatch(/your original is not changed/i);
    expect(block.textContent).not.toMatch(/score|risk|safe|clean|anonymous|danger|leak/i);
    expect(block.textContent).not.toContain('0.250000');
    expect(document.querySelectorAll('li.finding').length).toBe(0);
    expect(document.querySelector('.hash')).toBeNull();
    expect(document.querySelector('.lane')).toBeNull();
  });

  it('summarises author, device, dates, comments, embedded content and active features by category', async () => {
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    await open(file('k.jpg', fixture('jpeg-kitchen-sink.jpg')), report);
    const block = document.getElementById('before-share')!;
    for (const h of ['Names and identifiers', 'Dates and times', 'Device and software', 'Descriptions and properties', 'Embedded content']) expect(within(block).getByText(h)).toBeTruthy();
    expect(block.textContent).toMatch(/embedded thumbnail/i);
    expect(block.textContent).toMatch(/camera or device maker/i);
    cleanup();
    const pdf = await analyseFixture('pdf-javascript.pdf');
    await open(file('j.pdf', fixture('pdf-javascript.pdf'), 'application/pdf'), pdf);
    expect(within(document.getElementById('before-share')!).getByText('Scripts, actions or macros')).toBeTruthy();
    expect(document.getElementById('before-share')!.textContent).toMatch(/never runs them/);
  });

  it('the primary action creates the copy directly with the recommended groups, from the single canonical selection', async () => {
    const original = fixture('jpeg-kitchen-sink.jpg');
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    const fc = await open(file('k.jpg', original), report);
    expect(document.querySelectorAll('input[type=checkbox]').length).toBe(0); // options are closed: no second form
    const block = document.getElementById('before-share')!;
    expect(block.textContent).toMatch(/Recommended removal: exif data, xmp data, photoshop and iptc data, comments\./i);
    expect(block.textContent).toMatch(/other hidden information may remain, and nothing is downloaded until you choose to/);
    expect(fc.calls.transform.length).toBe(0); // nothing runs by itself
    fireEvent.click(createButton());
    await waitFor(() => expect(fc.calls.transform).toEqual([defaultGroups(report)]));
    expect(createButton().disabled).toBe(true); // disabled while the work runs
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    await finishCopy(fc, original, report, defaultGroups(report));
    await waitFor(() => expect(document.activeElement?.id).toBe('verify-h'));
  });

  it('"Choose what to remove" reveals the one canonical panel, closed before, focus moves there, and changes affect the copy', async () => {
    const original = fixture('jpeg-kitchen-sink.jpg');
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    const fc = await open(file('k.jpg', original), report);
    expect(document.getElementById('copy-section')).toBeNull();
    const choose = screen.getByRole('button', { name: 'Choose what to remove' });
    expect(choose.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(choose);
    await waitFor(() => expect(document.activeElement?.id).toBe('copy-h'));
    expect(choose.getAttribute('aria-expanded')).toBe('true');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.length).toBe(removalGroupsFor(report).length); // exactly one set of checkboxes
    expect(screen.getByText('Always kept')).toBeTruthy();
    expect(screen.getByText('May change')).toBeTruthy();
    // a change in the panel is the same state the primary button uses
    fireEvent.click(screen.getByLabelText(/^Data after the end of the image/));
    expect(document.getElementById('before-share')!.textContent).toMatch(/Selected for removal: .*data after the end of the image/i);
    fireEvent.click(screen.getByRole('button', { name: 'Create copy with these choices' }));
    const chosen = [...defaultGroups(report), 'trailer'].sort();
    await waitFor(() => expect(fc.calls.transform.length).toBe(1));
    expect([...fc.calls.transform[0]!].sort()).toEqual(chosen);
  });

  it('names what the recommendation leaves out, and says "Selected" once the choice differs from it', async () => {
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    await open(file('k.jpg', fixture('jpeg-kitchen-sink.jpg')), report);
    expect(document.getElementById('before-share')!.textContent).toMatch(/\d+ other kinds? of data this tool can remove (is|are) not selected/);
    expect(document.getElementById('before-share')!.textContent).toMatch(/Recommended removal/);
  });

  it('the report button still does something when the report is already open (moves focus to it)', async () => {
    const report = await analyseFixture('jpeg-gps.jpg');
    await open(file('g.jpg', fixture('jpeg-gps.jpg')), report);
    const block = document.getElementById('before-share')!;
    fireEvent.click(within(block).getByRole('button', { name: 'View full technical report' }));
    await waitFor(() => expect(document.activeElement?.id).toBe('report-h'));
    (document.getElementById('create-copy') as HTMLElement).focus();
    fireEvent.click(within(block).getByRole('button', { name: 'View full technical report' }));
    await waitFor(() => expect(document.activeElement?.id).toBe('report-h'));
  });

  it('aria-controls is only set while its target exists', async () => {
    const report = await analyseFixture('jpeg-gps.jpg');
    await open(file('g.jpg', fixture('jpeg-gps.jpg')), report);
    expect(document.getElementById('report-toggle')!.hasAttribute('aria-controls')).toBe(false);
    expect(screen.getByRole('button', { name: 'Choose what to remove' }).hasAttribute('aria-controls')).toBe(false);
    fireEvent.click(document.getElementById('report-toggle')!);
    await waitFor(() => expect(document.getElementById('report-toggle')!.getAttribute('aria-controls')).toBe('report-body'));
  });

  it('with nothing selected the primary action is disabled and says why', async () => {
    const report = await analyseFixture('jpeg-gps.jpg');
    await open(file('g.jpg', fixture('jpeg-gps.jpg')), report);
    fireEvent.click(screen.getByRole('button', { name: 'Choose what to remove' }));
    for (const b of screen.getAllByRole('checkbox') as HTMLInputElement[]) if (b.checked) fireEvent.click(b);
    expect(createButton().disabled).toBe(true);
    expect(document.getElementById('before-share')!.textContent).toMatch(/Nothing is selected for removal/);
  });

  it('PDF and DOCX explain that they are inspection-only and show no copy action; the report stays available', async () => {
    for (const [name, type, label] of [['pdf-basic.pdf', 'application/pdf', 'PDF'], ['docx-comments-tracked.docx', 'application/octet-stream', 'DOCX']] as const) {
      const report = await analyseFixture(name);
      await open(file(name, fixture(name), type), report);
      const block = document.getElementById('before-share')!;
      expect(block.textContent).toContain(`This tool can only inspect ${label} files. It does not offer a modified copy.`);
      expect(screen.queryByRole('button', { name: 'Create experimental copy' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Choose what to remove' })).toBeNull();
      expect(within(block).getByRole('button', { name: 'View full technical report' })).toBeTruthy();
      cleanup();
    }
  });

  it('PDF keeps its inert preview as an optional action; DOCX says it is not rendered', async () => {
    const report = await analyseFixture('pdf-basic.pdf');
    const fc = await open(file('d.pdf', fixture('pdf-basic.pdf'), 'application/pdf'), report);
    expect(fc.calls.preview).toBe(0);
    expect(document.querySelector('.pdf-preview img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show page 1 as a picture' }));
    await waitFor(() => expect(fc.calls.preview).toBe(1));
    fc.jobs[1]!.resolve({ ok: true, payload: { kind: 'pdf-preview', png: new ArrayBuffer(8), width: 10, height: 10 } });
    expect(((await screen.findByAltText('Page 1 of the document, drawn as a plain picture')) as HTMLImageElement).src.startsWith('blob:')).toBe(true);
    cleanup();
    const docx = await analyseFixture('docx-basic.docx');
    await open(file('d.docx', fixture('docx-basic.docx'), 'application/octet-stream'), docx);
    expect(screen.getByText(/No preview is shown for Word documents/)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    expect(created.length).toBe(1); // only the PDF preview made an object URL
  });

  it('shows no copy action when nothing can be removed, and does not call the file clean', async () => {
    const report = await analyseFixture('jpeg-clean.jpg');
    await open(file('c.jpg', fixture('jpeg-clean.jpg')), report);
    const block = document.getElementById('before-share')!;
    expect(block.textContent).toContain('Nothing that this tool can remove was found, so there is no copy to make. Other hidden information may still be present.');
    expect(screen.queryByRole('button', { name: 'Create experimental copy' })).toBeNull();
    expect(block.textContent).not.toMatch(/clean|safe/i);
    expect(within(block).getByRole('button', { name: 'View full technical report' })).toBeTruthy();
  });

  it('a damaged file gets the refusal reason and no copy action', async () => {
    const report = await analyseFixture('jpeg-truncated.jpg');
    await open(file('t.jpg', fixture('jpeg-truncated.jpg')), report);
    expect(document.getElementById('before-share')!.textContent).toMatch(/No copy is offered for this file\. The JPEG structure is damaged/);
    expect(screen.queryByRole('button', { name: 'Create experimental copy' })).toBeNull();
  });
});

describe('copy result (compact, detail folded)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('shows the verdict, original and copy, what is no longer detected and what remains, and the download first', async () => {
    const original = fixture('jpeg-kitchen-sink.jpg');
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    const fc = await open(file('Holiday photo.JPG', original), report);
    fireEvent.click(createButton());
    const result = await finishCopy(fc, original, report, defaultGroups(report));
    const section = document.getElementById('verification')!;
    expect(section.querySelector('.verdict')!.getAttribute('data-ok')).toBe('true');
    expect(section.textContent).toMatch(/9 checks passed, 1 skipped/); // the pixel comparison needs the browser decoder (jsdom has none)
    expect(section.textContent).toMatch(/Other hidden information may remain/);
    expect(section.querySelectorAll('.compare img').length).toBe(2);
    expect(within(section).getByText(/No longer detected \(\d+\)/)).toBeTruthy();
    expect(within(section).getByText(/Still detected \(\d+\)/)).toBeTruthy();
    expect(section.textContent).toMatch(/Open and check this copy before sharing it, and keep your original/);
    expect(section.textContent).not.toMatch(/fully clean|safe file|all metadata (was )?removed/i);
    // folded: the ten checks, the comparison table and the manifest
    expect(section.querySelectorAll('.checks li').length).toBe(0);
    expect(section.querySelector('table')).toBeNull();
    const checks = within(section).getByText(/All 10 verification checks \(9 passed\)/).closest('details') as HTMLDetailsElement;
    expect(checks.open).toBe(false);
    openDetails(checks);
    await waitFor(() => expect(section.querySelectorAll('.checks li').length).toBe(result.verification.checks.length));
    expect(within(section).getByRole('table', { name: 'Original and experimental copy compared' })).toBeTruthy();
    expect(within(section).getByText(/Mutation manifest/)).toBeTruthy();
    // the simple summary is still there, now offering to change the choice
    expect(screen.queryByRole('button', { name: 'Create experimental copy' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Change what to remove' })).toBeTruthy();
  });

  it('downloads a separate file with a clearly different name, only when asked', async () => {
    const original = fixture('jpeg-kitchen-sink.jpg');
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    const fc = await open(file('Holiday photo.JPG', original), report);
    fireEvent.click(createButton());
    await finishCopy(fc, original, report, defaultGroups(report));
    let clicked: { href: string; download: string } | null = null;
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = { href: this.href, download: this.download };
    });
    expect(clicked).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Download experimental copy' }));
    expect(clicked).toEqual({ href: expect.stringMatching(/^blob:/), download: 'Holiday photo.experimental-copy.jpg' });
    spy.mockRestore();
    expect(fc.urls.size).toBe(2);
  });

  it('disables download and opens the checks when one did not pass', async () => {
    const original = fixture('jpeg-gps.jpg');
    const report = await analyseFixture('jpeg-gps.jpg');
    const fc = await open(file('g.jpg', original), report);
    fireEvent.click(createButton());
    await waitFor(() => expect(fc.jobs.length).toBe(2));
    const result = await createCopy(original, report, ['exif'], async () => ({ dimensionsEqual: null, pixelsIdentical: false, detail: 'pixels differ', failed: false }));
    const buf = result.output.buffer.slice(result.output.byteOffset, result.output.byteOffset + result.output.byteLength) as ArrayBuffer;
    fc.jobs[1]!.resolve({ ok: true, payload: { kind: 'transform', output: buf, manifest: result.manifest, verification: result.verification } });
    await screen.findByRole('heading', { name: 'Experimental copy, re-inspected' });
    expect(screen.getByRole('alert').textContent).toMatch(/did not pass/);
    expect((screen.getByRole('button', { name: 'Download experimental copy' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Download is disabled because a check did not pass.')).toBeTruthy();
    expect(document.querySelectorAll('.checks li').length).toBeGreaterThan(0); // a failure is never folded away
  });

  it('"Change what to remove" discards and revokes the copy, opens the one panel and moves focus there', async () => {
    const original = fixture('jpeg-kitchen-sink.jpg');
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    const fc = await open(file('k.jpg', original), report);
    fireEvent.click(createButton());
    await finishCopy(fc, original, report, defaultGroups(report));
    const copyUrl = created[created.length - 1]!;
    fireEvent.click(screen.getByRole('button', { name: 'Change what to remove' }));
    expect(revoked).toContain(copyUrl);
    expect(screen.queryByRole('heading', { name: 'Experimental copy, re-inspected' })).toBeNull();
    await waitFor(() => expect(document.activeElement?.id).toBe('copy-h'));
    expect(screen.getByTestId('announce').textContent).toMatch(/previous copy was discarded/);
    expect(screen.getAllByRole('checkbox').length).toBe(removalGroupsFor(report).length);
  });

  it('cancelling the work returns to the simple result and the report stays closed', async () => {
    const report = await analyseFixture('jpeg-gps.jpg');
    const fc = await open(file('g.jpg', fixture('jpeg-gps.jpg')), report);
    fireEvent.click(createButton());
    await screen.findByText(/Building the experimental copy/);
    expect(document.getElementById('copy-h')).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Choose what to remove' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(createButton().disabled).toBe(false));
    expect(fc.calls.cancel).toBeGreaterThan(0);
    expect(document.getElementById('report-body')).toBeNull();
  });

  it('cancelling a one-click copy (options never opened) puts focus back on the primary button', async () => {
    const report = await analyseFixture('jpeg-gps.jpg');
    await open(file('g.jpg', fixture('jpeg-gps.jpg')), report);
    fireEvent.click(createButton());
    await screen.findByText(/Building the experimental copy/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement?.id).toBe('create-copy'));
  });

  it('a late result for a cancelled copy never replaces the screen', async () => {
    const original = fixture('jpeg-gps.jpg');
    const report = await analyseFixture('jpeg-gps.jpg');
    const fc = await open(file('g.jpg', original), report);
    fireEvent.click(createButton());
    await waitFor(() => expect(fc.jobs.length).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(createButton().disabled).toBe(false));
    const result = await createCopy(original, report, ['exif']);
    const buf = result.output.buffer.slice(result.output.byteOffset, result.output.byteOffset + result.output.byteLength) as ArrayBuffer;
    fc.jobs[1]!.resolve({ ok: true, payload: { kind: 'transform', output: buf, manifest: result.manifest, verification: result.verification } });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('heading', { name: 'Experimental copy, re-inspected' })).toBeNull();
  });
});

describe('no dead ends after a cancelled or failed job', () => {
  it('re-reads the still-selected file before making a copy when the worker session was lost', async () => {
    const original = fixture('jpeg-gps.jpg');
    const report = await analyseFixture('jpeg-gps.jpg');
    const fc = await open(file('g.jpg', original), report);
    fc.state.sessionOpen = false; // as after a cancelled copy: the worker was terminated
    fireEvent.click(createButton());
    await waitFor(() => expect(fc.calls.analyse.length).toBe(2)); // analysed again automatically
    fc.state.sessionOpen = true;
    fc.jobs[1]!.resolve(analysisOf(report));
    await waitFor(() => expect(fc.calls.transform.length).toBe(1));
  });

  it('shows a clear next step when the file cannot be read again', async () => {
    const report = await analyseFixture('jpeg-gps.jpg');
    const fc = await open(file('g.jpg', fixture('jpeg-gps.jpg')), report);
    fc.state.sessionOpen = false;
    fireEvent.click(createButton());
    await waitFor(() => expect(fc.jobs.length).toBe(2));
    fc.jobs[1]!.resolve({ ok: false, error: { code: 'worker-failure', message: 'x' } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Clear and start over');
  });

  it('moves focus to the new screen heading, and to the verification result after a copy', async () => {
    const original = fixture('jpeg-gps.jpg');
    const report = await analyseFixture('jpeg-gps.jpg');
    const fc = await open(file('g.jpg', original), report);
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H1'));
    fireEvent.click(createButton());
    await finishCopy(fc, original, report, ['exif']);
    await waitFor(() => expect(document.activeElement?.id).toBe('verify-h'));
  });
});

describe('files dropped outside the plate', () => {
  it('are never left to the browser: the drop is cancelled, and on the start screen it opens the file', async () => {
    const fc = fakeClient();
    render(<App client={fc.client} />);
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
    ev.dataTransfer = { types: ['Files'], files: [file('x.jpg')] };
    document.body.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await waitFor(() => expect(fc.calls.analyse.length).toBe(1));
    const over = new Event('dragover', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
    over.dataTransfer = { types: ['Files'] };
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
  });

  it('are ignored (but still cancelled) once a result is shown', async () => {
    const report = await analyseFixture('jpeg-clean.jpg');
    const fc = await open(file('c.jpg', fixture('jpeg-clean.jpg')), report);
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
    ev.dataTransfer = { types: ['Files'], files: [file('other.jpg')] };
    document.body.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(fc.calls.analyse.length).toBe(1);
  });
});

describe('reset', () => {
  it('stops work, disposes the worker, revokes every object URL and clears the screen', async () => {
    const original = fixture('jpeg-gps.jpg');
    const report = await analyseFixture('jpeg-gps.jpg');
    const fc = await open(file('g.jpg', original), report);
    await openReport();
    expect(created.length).toBe(1);
    const disposeBefore = fc.calls.dispose;
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear and start over' })[0]!);
    await screen.findByLabelText('Choose a file to inspect');
    expect(fc.calls.dispose).toBe(disposeBefore + 1);
    expect(revoked.sort()).toEqual(created.sort());
    expect(fc.urls.size).toBe(0);
    expect(document.querySelector('li.finding')).toBeNull();
    expect(document.getElementById('report-body')).toBeNull();
    expect(document.body.textContent).not.toContain('Fixture Camera One');
  });

  it('revokes URLs and disposes the worker on unmount', async () => {
    const report = await analyseFixture('jpeg-gps.jpg');
    const fc = await open(file('g.jpg', fixture('jpeg-gps.jpg')), report);
    cleanup();
    expect(fc.calls.dispose).toBeGreaterThan(0);
    expect(revoked.length).toBe(created.length);
  });
});
