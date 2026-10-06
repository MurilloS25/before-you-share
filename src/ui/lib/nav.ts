/**
 * Move to a section and put keyboard focus on its heading, so assistive technology follows the jump
 * (a plain `#hash` link only scrolls). Honours "reduce motion". The heading gets `tabindex="-1"` if it has none.
 */
export function goTo(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  el.focus({ preventScroll: true });
  // A heading followed by a closed disclosure (for example the structural category) opens it, so the jump lands on content.
  const next = el.nextElementSibling;
  if (next instanceof HTMLDetailsElement && !next.open) next.open = true;
}
