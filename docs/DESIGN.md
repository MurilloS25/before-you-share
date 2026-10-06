# Design notes

Concept: a light table. A specimen is laid on a pale plate, hidden layers are shown as sheets behind it,
and findings are annotations with evidence. It should feel like inspection equipment, not a dashboard.

- **Palette**: plate `#dfe7ea`, sheet `#f6f9fa`, ink `#13232c`, film blue `#1b5a78` (structure and action),
  amber-brown `#7a5200` on `#fbefd3` (only for "suspicious", meaning unusual), slate for unsupported. Red
  appears only for a failed verification. No decorative gradients (the only repeating gradient is the
  hatching that marks inferred or unsupported marks on the file map).
- **Type**: Source Serif 4 for reading text and headlines (calm, bookish), Barlow Semi Condensed for
  labels and data (technical, compact). Fonts are bundled. Line length stays under 80 characters.
- **First answer**: below the file's name and size sits a plain "Before you share" block. It summarises *categories* (an exact
  location, names and identifiers, dates, device and software, descriptions, embedded content, scripts or macros), says that common data
  is not automatically a problem, and offers one primary action ("Review copy options") that scrolls to the single copy panel and moves focus to its
  heading. It holds no checkboxes (one selection state only), has no score, and never says a file is safe, clean or anonymous. PDF and DOCX
  get an honest sentence instead of an action.
- **Progressive disclosure**: SHA-256, reported type, status legend and the file map are folded under named summaries. Evidence, the map, the
  manifest and the structural category build their content only when opened. Coverage ("What this tool did not fully check") and the findings
  themselves are never folded. Internal links move focus, not only scroll. Nothing is sticky, so nothing can cover content at high zoom.
- **Memorable element**: the **file map**, a strip chart where each lane is a category and each mark is a
  finding at its real byte position, answering "where was it?" at a glance. The text list remains the
  source of truth.
- **Intake plate**: crop marks at the corners and two faint sheets behind it that fan out once on load.
- **Motion**: one reveal on load and a scan line while a job runs. Both are disabled by
  `prefers-reduced-motion`; the progress text carries the meaning.
- **Status without colour**: every status has a word, a mark, and a border style (solid verified,
  dashed inferred, dotted unsupported, amber suspicious).
- **No dark theme**: a dark mode must be designed rather than inverted; none ships.
- **Rejected defaults**: cream background with a clay accent, near-black with a neon accent, repeated
  rounded cards, tracked all-caps labels, numbered step markers, monospace "terminal" styling.
- **Accessibility**: real file input with a visible focus ring around the plate, headings in order,
  details disclosures for evidence, role=status progress, role=alert for errors and failed checks, tables
  with captions and scoped headers, 44 px minimum height for buttons, disclosure summaries and navigation links, 320 px reflow, rem-based layout for text zoom.
