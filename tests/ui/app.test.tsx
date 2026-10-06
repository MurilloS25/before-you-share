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

describe('inspection result', () => {
  it('groups findings calmly by category with status words, evidence and limits', async () => {
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    await open(file('kitchen.jpg', fixture('jpeg-kitchen-sink.jpg')), report);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '');
    const order = ['Location', 'Identity', 'Time', 'Device and software', 'Document properties', 'Embedded content'].map((c) => headings.findIndex((h) => h.startsWith(c)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const gps = screen.getByText('GPS position').closest('li')!;
    expect(within(gps).getByText('0.250000° N, 0.750000° E')).toBeTruthy();
    expect(within(gps).getByText('Verified')).toBeTruthy();
    expect(within(gps).getByText(/Coordinates can point to where the photo was taken/)).toBeTruthy();
    const evidence = within(gps).getByText('Evidence and limits').closest('details')!;
    expect(evidence.querySelector('dl.evidence')).toBeNull(); // not built until opened
    openDetails(evidence);
    await waitFor(() => expect(evidence.querySelector('dl.evidence')).not.toBeNull());
    expect(evidence.textContent).toContain('JPEG APP1 Exif');
    expect(evidence.textContent).toMatch(/Bytes [\d,]+ to [\d,]+/);
    expect(evidence.textContent).toContain('The experimental copy can remove this.');
    // Not alarmist: no score, no "danger" wording.
    expect(document.body.textContent).not.toMatch(/risk score|danger|unsafe|leak|exposed/i);
    // Statuses are words, not colour only.
    const unsupported = screen.getByText('Manufacturer-specific data (MakerNote)').closest('li')!;
    expect(within(unsupported).getByText('Not supported')).toBeTruthy();
    const suspicious = screen.getAllByText('Data after the end of the image').map((e) => e.closest<HTMLElement>('li.finding')).find(Boolean)!;
    expect(within(suspicious).getByText('Suspicious')).toBeTruthy();
    expect(screen.getByText(/Suspicious/, { selector: 'em' })).toBeTruthy();
    // Coverage and limits are always present.
    expect(screen.getByRole('heading', { name: 'What this tool did not fully check' })).toBeTruthy();
    expect(screen.getByText(/Other hidden information may remain in this file/)).toBeTruthy();
  });

  it('draws a file map lane per located category and keeps the textual list as the source of truth', async () => {
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    await open(file('kitchen.jpg', fixture('jpeg-kitchen-sink.jpg')), report);
    expect(document.querySelectorAll('.lane').length).toBe(0); // the map is built when its section is opened
    openDetails(screen.getByText(/Where findings sit in the file/).closest('details'));
    await waitFor(() => expect(document.querySelectorAll('.lane').length).toBeGreaterThan(3));
    for (const t of document.querySelectorAll<HTMLElement>('.tick')) {
      const left = parseFloat(t.style.left);
      const width = parseFloat(t.style.width);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + width).toBeLessThanOrEqual(100.01);
    }
    expect(document.querySelector('.lane-track')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders hostile metadata as text, never as markup', async () => {
    const report = await analyseFixture('jpeg-hostile-metadata.jpg');
    const { utils } = await open(file('h.jpg', fixture('jpeg-hostile-metadata.jpg')), report);
    expect(utils.container.querySelector('script')).toBeNull();
    expect(utils.container.querySelector('img[src="x"]')).toBeNull();
    expect(utils.container.querySelector('svg')).toBeNull();
    expect(utils.container.textContent).toContain('<img src=x onerror=alert(1)><script>alert(2)</script>');
  });

  it('PDF results never offer a copy and load the preview only on request', async () => {
    const report = await analyseFixture('pdf-basic.pdf');
    const fc = await open(file('d.pdf', fixture('pdf-basic.pdf'), 'application/pdf'), report);
    expect(screen.getByText(/Copies are not offered for PDF files/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make experimental copy' })).toBeNull();
    expect(fc.calls.preview).toBe(0);
    expect(document.querySelector('.pdf-preview img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show page 1 as a picture' }));
    await waitFor(() => expect(fc.calls.preview).toBe(1));
    fc.jobs[1]!.resolve({ ok: true, payload: { kind: 'pdf-preview', png: new ArrayBuffer(8), width: 10, height: 10 } });
    const img = (await screen.findByAltText('Page 1 of the document, drawn as a plain picture')) as HTMLImageElement;
    expect(img.src.startsWith('blob:')).toBe(true);
  });
});

describe('DOCX results', () => {
  it('are inspection-only: findings, active features and limits, no copy and no preview', async () => {
    const report = await analyseFixture('docx-comments-tracked.docx');
    await open(file('d.docx', fixture('docx-comments-tracked.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), report);
    expect(screen.getByText('Word document (DOCX)')).toBeTruthy();
    expect(screen.getByText('Tracked changes')).toBeTruthy();
    expect(screen.getByText('Comment authors')).toBeTruthy();
    expect(screen.getByText(/Copies are not offered for DOCX files/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make experimental copy' })).toBeNull();
    expect(screen.getByText(/No preview is shown for Word documents/)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    expect(created.length).toBe(0); // no object URL is created for a document
  });
});

describe('"Before you share" block', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('says plainly that a photo contains an exact location, without scoring or verdicts', async () => {
    const report = await analyseFixture('jpeg-gps.jpg');
    await open(file('g.jpg', fixture('jpeg-gps.jpg')), report);
    const block = document.getElementById('before-share')!;
    expect(within(block).getByRole('heading', { level: 2, name: 'Before you share' })).toBeTruthy();
    expect(within(block).getByText('An exact location')).toBeTruthy();
    expect(within(block).getByText(/GPS coordinates that can point to where it was taken/)).toBeTruthy();
    expect(block.textContent).toMatch(/Common data is not automatically a problem, and other hidden information may remain/);
    expect(block.textContent).not.toMatch(/score|risk|safe|clean|anonymous|danger|leak/i);
    expect(block.textContent).not.toContain('0.250000'); // the coordinates stay in the evidence, not in the summary
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

  it('offers the copy action for JPEG and PNG with removable groups and moves scroll and focus to the single copy panel', async () => {
    const report = await analyseFixture('png-kitchen-sink.png');
    await open(file('p.png', fixture('png-kitchen-sink.png'), 'image/png'), report);
    const block = document.getElementById('before-share')!;
    expect(within(block).getByText(/An experimental copy can leave out/)).toBeTruthy();
    const checkboxesBefore = document.querySelectorAll('input[type=checkbox]').length;
    expect(within(block).queryAllByRole('checkbox')).toHaveLength(0); // no second form
    fireEvent.click(within(block).getByRole('button', { name: 'Review copy options' }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    const heading = document.getElementById('copy-h')!;
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(document.querySelectorAll('input[type=checkbox]').length).toBe(checkboxesBefore); // still exactly one selection state
  });

  it('keeps one selection: toggling in the panel changes what the block says it can leave out only through the same groups', async () => {
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    await open(file('k.jpg', fixture('jpeg-kitchen-sink.jpg')), report);
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.length).toBe(removalGroupsFor(report).length);
    fireEvent.click(boxes[0]!);
    expect(boxes[0]!.checked).toBe(false);
  });

  it('PDF and DOCX explain that they are inspection-only and show no copy action', async () => {
    for (const [name, type, label] of [['pdf-basic.pdf', 'application/pdf', 'PDF'], ['docx-basic.docx', 'application/octet-stream', 'DOCX']] as const) {
      const report = await analyseFixture(name);
      await open(file(name, fixture(name), type), report);
      const block = document.getElementById('before-share')!;
      expect(block.textContent).toContain(`This tool can only inspect ${label} files. It does not offer a modified copy.`);
      expect(within(block).queryByRole('button', { name: 'Review copy options' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Make experimental copy' })).toBeNull();
      cleanup();
    }
  });

  it('shows no action when nothing can be removed', async () => {
    const report = await analyseFixture('jpeg-clean.jpg');
    await open(file('c.jpg', fixture('jpeg-clean.jpg')), report);
    const block = document.getElementById('before-share')!;
    expect(block.textContent).toContain('Nothing that this tool can remove was found, so there is no copy to make.');
    expect(within(block).queryByRole('button', { name: 'Review copy options' })).toBeNull();
    expect(within(block).getByRole('button', { name: 'What was not checked' })).toBeTruthy();
  });

  it('the other links move focus to their headings too', async () => {
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    await open(file('k.jpg', fixture('jpeg-kitchen-sink.jpg')), report);
    const block = document.getElementById('before-share')!;
    fireEvent.click(within(block).getByRole('button', { name: 'What was not checked' }));
    expect(document.activeElement?.id).toBe('coverage-h');
    fireEvent.click(within(block).getByRole('button', { name: 'Review all findings' }));
    expect(document.activeElement?.id).toBe('findings-h');
    fireEvent.click(within(block).getAllByRole('button', { name: /^See .* findings$/ })[0]!);
    expect(document.activeElement?.id).toMatch(/^cat-h-/);
    // category navigation links move focus as well, not only scroll
    const link = screen.getByRole('navigation', { name: 'Jump to a category' }).querySelector('a')!;
    fireEvent.click(link);
    expect(document.activeElement?.id).toMatch(/^cat-h-/);
  });
});

describe('progressive disclosure', () => {
  it('keeps technical detail available but folded: SHA-256, reported type, status legend and the file map', async () => {
    const report = await analyseFixture('jpeg-gps.jpg');
    await open(file('g.jpg', fixture('jpeg-gps.jpg')), report);
    const sha = document.querySelector('.hash')!;
    expect((sha.closest('details') as HTMLDetailsElement).open).toBe(false);
    expect(sha.textContent).toBe(report.fingerprint.sha256);
    expect(screen.getByText(/Technical details: extension, reported type, SHA-256/)).toBeTruthy();
    const legend = screen.getByText('How to read the status labels').closest('details') as HTMLDetailsElement;
    expect(legend.open).toBe(false);
    // coverage and its warnings are never folded
    expect(screen.getByRole('heading', { name: 'What this tool did not fully check' })).toBeTruthy();
    expect(document.querySelector('.coverage')!.closest('details')).toBeNull();
    // the findings themselves stay visible
    expect(screen.getByText('GPS position').closest('details')).toBeNull();
  });

  it('does not mount the items of a closed structural category, and mounts them when it is opened', async () => {
    const report = await analyseFixture('jpeg-clean.jpg');
    await open(file('c.jpg', fixture('jpeg-clean.jpg')), report);
    const section = document.querySelector('[data-category="structural"]')!;
    expect(section.querySelectorAll('li.finding').length).toBe(0);
    openDetails(section.querySelector('details'));
    await waitFor(() => expect(section.querySelectorAll('li.finding').length).toBeGreaterThan(0));
  });
});

describe('experimental copy', () => {
  it('lists what is removed, kept and may change before anything runs', async () => {
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    const fc = await open(file('k.jpg', fixture('jpeg-kitchen-sink.jpg')), report);
    expect(screen.getByRole('group', { name: 'Choose what to remove from the copy' })).toBeTruthy();
    expect((screen.getByLabelText(/^EXIF data/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/^Data after the end of the image/) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('Will be removed')).toBeTruthy();
    expect(screen.getByText('Will stay in the copy')).toBeTruthy();
    expect(screen.getByText('Always kept')).toBeTruthy();
    expect(screen.getByText('May change')).toBeTruthy();
    const before = document.querySelector('.plan')!.textContent;
    fireEvent.click(screen.getByLabelText(/^Data after the end of the image/));
    expect(document.querySelector('.plan')!.textContent).not.toBe(before);
    expect(fc.calls.transform.length).toBe(0); // no automatic action
    const button = screen.getByRole('button', { name: 'Make experimental copy' }) as HTMLButtonElement;
    for (const l of screen.getAllByRole('checkbox') as HTMLInputElement[]) if (l.checked) fireEvent.click(l);
    expect(button.disabled).toBe(true);
  });

  it('builds, verifies, compares and downloads a separate file with a clearly different name', async () => {
    const original = fixture('jpeg-kitchen-sink.jpg');
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    const fc = await open(file('Holiday photo.JPG', original), report);
    const groups = removalGroupsFor(report).filter((g) => g.defaultOn).map((g) => g.id);
    fireEvent.click(screen.getByRole('button', { name: 'Make experimental copy' }));
    await waitFor(() => expect(fc.calls.transform).toEqual([groups]));
    expect(screen.getByText(/Experimental copy: Building the experimental copy/)).toBeTruthy();
    const result = await createCopy(original, report, groups);
    const buf = result.output.buffer.slice(result.output.byteOffset, result.output.byteOffset + result.output.byteLength) as ArrayBuffer;
    fc.jobs[1]!.resolve({ ok: true, payload: { kind: 'transform', output: buf, manifest: result.manifest, verification: result.verification } });
    await screen.findByRole('heading', { name: 'Experimental copy, re-inspected' });
    expect(document.querySelector('.verdict')!.getAttribute('data-ok')).toBe('true');
    expect(screen.getAllByText(/Other hidden information may remain/).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.compare img').length).toBe(2);
    expect(document.querySelectorAll('.checks li').length).toBe(result.verification.checks.length);
    expect(screen.getByRole('table', { name: 'Original and experimental copy compared' })).toBeTruthy();
    expect(screen.getByText(/Open and check this copy before sharing it/)).toBeTruthy();
    expect(screen.getByText(/Keep your original/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/fully clean|safe file|all metadata (was )?removed/i);

    let clicked: { href: string; download: string } | null = null;
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = { href: this.href, download: this.download };
    });
    expect(clicked).toBeNull(); // nothing downloads until the button is pressed
    fireEvent.click(screen.getByRole('button', { name: 'Download experimental copy' }));
    expect(clicked).toEqual({ href: expect.stringMatching(/^blob:/), download: 'Holiday photo.experimental-copy.jpg' });
    spy.mockRestore();
    expect(fc.urls.size).toBe(2); // original preview and copy
  });

  it('disables download and says why when a verification check did not pass', async () => {
    const original = fixture('jpeg-gps.jpg');
    const report = await analyseFixture('jpeg-gps.jpg');
    const fc = await open(file('g.jpg', original), report);
    fireEvent.click(screen.getByRole('button', { name: 'Make experimental copy' }));
    await waitFor(() => expect(fc.jobs.length).toBe(2));
    const result = await createCopy(original, report, ['exif'], async () => ({ dimensionsEqual: null, pixelsIdentical: false, detail: 'pixels differ', failed: false }));
    const buf = result.output.buffer.slice(result.output.byteOffset, result.output.byteOffset + result.output.byteLength) as ArrayBuffer;
    fc.jobs[1]!.resolve({ ok: true, payload: { kind: 'transform', output: buf, manifest: result.manifest, verification: result.verification } });
    await screen.findByRole('heading', { name: 'Experimental copy, re-inspected' });
    expect(screen.getByRole('alert').textContent).toMatch(/did not pass/);
    expect((screen.getByRole('button', { name: 'Download experimental copy' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Download is disabled because a check did not pass.')).toBeTruthy();
  });

  it('shows a refusal reason instead of a copy option for damaged files', async () => {
    const report = await analyseFixture('jpeg-truncated.jpg');
    await open(file('t.jpg', fixture('jpeg-truncated.jpg')), report);
    expect(screen.getAllByText(/No copy is offered for this file/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Make experimental copy' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review copy options' })).toBeNull(); // no misleading action
  });

  it('cancelling a copy returns to the inspection result', async () => {
    const report = await analyseFixture('jpeg-gps.jpg');
    const fc = await open(file('g.jpg', fixture('jpeg-gps.jpg')), report);
    fireEvent.click(screen.getByRole('button', { name: 'Make experimental copy' }));
    await screen.findByText(/Building the experimental copy/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('button', { name: 'Make experimental copy' });
    expect(fc.calls.cancel).toBeGreaterThan(0);
    expect(screen.getByText('GPS position')).toBeTruthy(); // the inspection is still there
  });
});

describe('no dead ends after a cancelled or failed job', () => {
  it('re-reads the still-selected file before making a copy when the worker session was lost', async () => {
    const original = fixture('jpeg-gps.jpg');
    const report = await analyseFixture('jpeg-gps.jpg');
    const fc = await open(file('g.jpg', original), report);
    fc.state.sessionOpen = false; // as after a cancelled copy: the worker was terminated
    fireEvent.click(screen.getByRole('button', { name: 'Make experimental copy' }));
    await waitFor(() => expect(fc.calls.analyse.length).toBe(2)); // analysed again automatically
    fc.state.sessionOpen = true;
    fc.jobs[1]!.resolve(analysisOf(report));
    await waitFor(() => expect(fc.calls.transform.length).toBe(1));
  });

  it('shows a clear next step when the file cannot be read again', async () => {
    const report = await analyseFixture('jpeg-gps.jpg');
    const fc = await open(file('g.jpg', fixture('jpeg-gps.jpg')), report);
    fc.state.sessionOpen = false;
    fireEvent.click(screen.getByRole('button', { name: 'Make experimental copy' }));
    await waitFor(() => expect(fc.jobs.length).toBe(2));
    fc.jobs[1]!.resolve({ ok: false, error: { code: 'worker-failure', message: 'x' } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Clear and start over');
  });

  it('moves focus to the new screen heading and to the verification result', async () => {
    const original = fixture('jpeg-gps.jpg');
    const report = await analyseFixture('jpeg-gps.jpg');
    const fc = await open(file('g.jpg', original), report);
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H1'));
    fireEvent.click(screen.getByRole('button', { name: 'Make experimental copy' }));
    await waitFor(() => expect(fc.jobs.length).toBe(2));
    const result = await createCopy(original, report, ['exif']);
    const buf = result.output.buffer.slice(result.output.byteOffset, result.output.byteOffset + result.output.byteLength) as ArrayBuffer;
    fc.jobs[1]!.resolve({ ok: true, payload: { kind: 'transform', output: buf, manifest: result.manifest, verification: result.verification } });
    await screen.findByRole('heading', { name: 'Experimental copy, re-inspected' });
    await waitFor(() => expect(document.activeElement?.id).toBe('verify-h'));
  });

  it('discards and revokes a finished copy when the selection changes, and says so', async () => {
    const original = fixture('jpeg-kitchen-sink.jpg');
    const report = await analyseFixture('jpeg-kitchen-sink.jpg');
    const fc = await open(file('k.jpg', original), report);
    fireEvent.click(screen.getByRole('button', { name: 'Make experimental copy' }));
    await waitFor(() => expect(fc.jobs.length).toBe(2));
    const groups = removalGroupsFor(report).filter((g) => g.defaultOn).map((g) => g.id);
    const result = await createCopy(original, report, groups);
    const buf = result.output.buffer.slice(result.output.byteOffset, result.output.byteOffset + result.output.byteLength) as ArrayBuffer;
    fc.jobs[1]!.resolve({ ok: true, payload: { kind: 'transform', output: buf, manifest: result.manifest, verification: result.verification } });
    await screen.findByRole('heading', { name: 'Experimental copy, re-inspected' });
    const copyUrl = created[created.length - 1]!;
    fireEvent.click(screen.getByLabelText(/^Data after the end of the image/));
    expect(revoked).toContain(copyUrl);
    expect(screen.queryByRole('heading', { name: 'Experimental copy, re-inspected' })).toBeNull();
    expect(screen.getByTestId('announce').textContent).toMatch(/previous copy was discarded/);
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
    const report = await analyseFixture('jpeg-gps.jpg');
    const fc = await open(file('g.jpg', fixture('jpeg-gps.jpg')), report);
    expect(created.length).toBe(1);
    const disposeBefore = fc.calls.dispose;
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear and start over' })[0]!);
    await screen.findByLabelText('Choose a file to inspect');
    expect(fc.calls.dispose).toBe(disposeBefore + 1);
    expect(revoked.sort()).toEqual(created.sort());
    expect(fc.urls.size).toBe(0);
    expect(document.querySelector('li.finding')).toBeNull();
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
