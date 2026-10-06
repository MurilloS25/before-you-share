import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { plural } from '../lib/format';

interface LazyProps {
  summary: ComponentChildren;
  children: ComponentChildren;
  /** Initially open (its content is then mounted immediately). */
  open?: boolean;
  class?: string;
}

/**
 * A native `<details>` whose content is not built until the first time it is opened. A closed section
 * therefore costs one summary node, however large its content would be.
 */
export function LazyDetails({ summary, children, open, class: cls }: LazyProps) {
  const [opened, setOpened] = useState(!!open);
  return (
    <details
      class={cls}
      open={open || undefined}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary>{summary}</summary>
      {opened ? children : null}
    </details>
  );
}

interface ShowMoreProps<T> {
  items: T[];
  render: (item: T, index: number) => JSX.Element;
  /** Noun for the status line, singular and plural forms. */
  noun: [string, string];
  /** At or below this many items everything is shown at once. */
  threshold?: number;
  initial?: number;
  step?: number;
  listClass?: string;
  id: string;
}

/**
 * Renders a bounded slice of a list with an accessible control to reveal the rest. Everything the parser kept
 * remains reachable; only the first screenful is built at first. Focus moves to the first newly revealed item
 * so keyboard users continue where they were.
 */
export function ShowMore<T>({ items, render, noun, threshold = 12, initial = 10, step = 50, listClass, id }: ShowMoreProps<T>) {
  const total = items.length;
  const [limit, setLimit] = useState(initial);
  const shown = total <= threshold ? total : Math.min(limit, total);
  const remaining = total - shown;
  const list = useRef<HTMLUListElement>(null);
  const focusIndex = useRef<number | null>(null);

  useEffect(() => {
    if (focusIndex.current !== null) {
      const el = list.current?.children[focusIndex.current] as HTMLElement | undefined;
      if (el) {
        el.setAttribute('tabindex', '-1');
        el.focus({ preventScroll: false });
      }
      focusIndex.current = null;
    }
  }, [shown]);

  const reveal = (n: number) => {
    focusIndex.current = shown;
    setLimit(shown + n);
  };

  return (
    <>
      <ul class={listClass} id={id} ref={list}>
        {items.slice(0, shown).map((item, i) => render(item, i))}
      </ul>
      {total > threshold && (
        <div class="showmore">
          <p class="showmore-status" role="status">
            Showing {shown} of {plural(total, noun[0], noun[1])}.
          </p>
          {remaining > 0 && (
            <div class="showmore-actions">
              <button type="button" class="button button-quiet" aria-controls={id} onClick={() => reveal(Math.min(step, remaining))}>
                Show {Math.min(step, remaining)} more ({remaining} remaining)
              </button>
              {remaining > step && (
                <button type="button" class="button button-quiet" aria-controls={id} onClick={() => reveal(remaining)}>
                  Show all {remaining} remaining
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
