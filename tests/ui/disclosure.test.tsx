// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { LazyDetails, ShowMore } from '../../src/ui/components/Disclosure';
import { FindingsByCategory } from '../../src/ui/components/Findings';
import { analyseJpeg } from '../../src/formats/jpeg';
import { baseJpeg, commentSegment, insertSegments } from '../../fixtures/lib/jpeg';

afterEach(() => cleanup());

describe('LazyDetails', () => {
  it('builds nothing until opened, then keeps its content', async () => {
    let built = 0;
    const Heavy = () => {
      built++;
      return <p>heavy content</p>;
    };
    const { container } = render(
      <LazyDetails summary="More">
        <Heavy />
      </LazyDetails>,
    );
    expect(built).toBe(0);
    expect(container.querySelector('p')).toBeNull();
    const d = container.querySelector('details')!;
    d.open = true;
    fireEvent(d, new Event('toggle'));
    await waitFor(() => expect(container.querySelector('p')).not.toBeNull());
    d.open = false;
    fireEvent(d, new Event('toggle'));
    expect(container.querySelector('p')).not.toBeNull();
  });

  it('mounts immediately when it starts open', () => {
    const { container } = render(
      <LazyDetails summary="Open" open>
        <p>visible</p>
      </LazyDetails>,
    );
    expect(container.querySelector('p')).not.toBeNull();
  });
});

describe('ShowMore', () => {
  const items = Array.from({ length: 130 }, (_, i) => i + 1);
  const view = () => render(<ShowMore items={items} id="l" noun={['thing', 'things']} render={(n) => <li key={n}>item {n}</li>} />);

  it('shows a bounded slice with an accurate status, and a labelled control for the rest', () => {
    const { container } = view();
    expect(container.querySelectorAll('li').length).toBe(10);
    expect(screen.getByRole('status').textContent).toBe('Showing 10 of 130 things.');
    const more = screen.getByRole('button', { name: /Show 50 more \(120 remaining\)/ });
    expect(more.getAttribute('aria-controls')).toBe('l');
    expect(screen.getByRole('button', { name: 'Show all 120 remaining' })).toBeTruthy();
  });

  it('reveals in steps, keeps the counts correct, and moves focus to the first new item', async () => {
    const { container } = view();
    fireEvent.click(screen.getByRole('button', { name: /Show 50 more/ }));
    await waitFor(() => expect(container.querySelectorAll('li').length).toBe(60));
    expect(screen.getByRole('status').textContent).toBe('Showing 60 of 130 things.');
    expect(document.activeElement?.textContent).toBe('item 11');
    fireEvent.click(screen.getByRole('button', { name: /Show 50 more/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Show 20 more (20 remaining)' }));
    await waitFor(() => expect(container.querySelectorAll('li').length).toBe(130));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Showing 130 of 130 things.');
  });

  it('"Show all" reaches every item at once', async () => {
    const { container } = view();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 120 remaining' }));
    await waitFor(() => expect(container.querySelectorAll('li').length).toBe(130));
  });

  it('shows short lists in full with no control', () => {
    const { container } = render(<ShowMore items={[1, 2, 3]} id="s" noun={['thing', 'things']} render={(n) => <li key={n}>{n}</li>} />);
    expect(container.querySelectorAll('li').length).toBe(3);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('a result with the maximum number of findings', () => {
  const jpeg = insertSegments(baseJpeg(), Array.from({ length: 620 }, (_, i) => commentSegment(`comment ${i}`)));
  const report = analyseJpeg(jpeg);

  it('keeps every finding the parser kept, reachable through Show more, with a small initial DOM', async () => {
    const comments = report.findings.filter((f) => f.code === 'jpeg.comment');
    const n = comments.length;
    expect(n).toBe(599); // the parser's cap (600 findings, one used by the JFIF header) is unchanged
    const { container } = render(<FindingsByCategory findings={report.findings} activeId={null} onActive={() => undefined} />);
    expect(container.querySelectorAll('li.finding').length).toBeLessThan(40);
    expect(container.querySelectorAll('*').length).toBeLessThan(900);
    const section = container.querySelector('section[data-category="document-properties"]') as HTMLElement;
    expect(within(section).getByRole('status').textContent).toBe(`Showing 10 of ${n} findings.`);
    fireEvent.click(within(section).getByRole('button', { name: `Show all ${n - 10} remaining` }));
    await waitFor(() => expect(section.querySelectorAll('li.finding').length).toBe(n));
    expect(within(section).getByRole('status').textContent).toBe(`Showing ${n} of ${n} findings.`);
    // every item is a real heading plus text, searchable once shown
    expect(within(section).getAllByText('JPEG comment').length).toBe(n);
  });

  it('uses a handful of delegated handlers, not one set per finding, and highlights through them', async () => {
    const seen: Array<string | null> = [];
    const { container } = render(<FindingsByCategory findings={report.findings} activeId={null} onActive={(id) => seen.push(id)} />);
    const first = container.querySelector('li.finding') as HTMLElement;
    fireEvent.mouseOver(first.querySelector('h3')!);
    expect(seen.at(-1)).toBe(first.dataset['id']);
    fireEvent.mouseLeave(first.closest('.finding-group')!);
    expect(seen.at(-1)).toBeNull();
  });

  it('builds the evidence of a finding only when it is opened', async () => {
    const { container } = render(<FindingsByCategory findings={report.findings} activeId={null} onActive={() => undefined} />);
    expect(container.querySelectorAll('dl.evidence').length).toBe(0);
    const d = container.querySelector('li.finding details') as HTMLDetailsElement;
    d.open = true;
    fireEvent(d, new Event('toggle'));
    await waitFor(() => expect(container.querySelectorAll('dl.evidence').length).toBe(1));
  });
});

describe('ShowMore thresholds', () => {
  const run = (n: number) => render(<ShowMore items={Array.from({ length: n }, (_, i) => i)} id={`t${n}`} noun={['item', 'items']} render={(i) => <li key={i}>{i}</li>} />);
  it('shows 12 in full, and 13 as 10 plus "Show 3 more (3 remaining)" without a Show all', () => {
    const a = run(12);
    expect(a.container.querySelectorAll('li').length).toBe(12);
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    const b = run(13);
    expect(b.container.querySelectorAll('li').length).toBe(10);
    expect(screen.getByRole('button', { name: 'Show 3 more (3 remaining)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });
  it('offers Show all only when more than one step remains', () => {
    run(70);
    expect(screen.getByRole('button', { name: 'Show 50 more (60 remaining)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show all 60 remaining' })).toBeTruthy();
  });
});
