# Design notes

Concept: a light table. A specimen is laid on a pale plate, hidden layers are shown as sheets behind it,
and findings are annotations with evidence. It should feel like inspection equipment, not a dashboard.

- **Palette**: plate `#dfe7ea`, sheet `#f6f9fa`, ink `#13232c`, film blue `#1b5a78` (structure and action),
  amber-brown `#7a5200` on `#fbefd3` (only for "suspicious", meaning unusual), slate for unsupported. Red
  appears only for a failed verification. No decorative gradients (the only repeating gradient is the
  hatching that marks inferred or unsupported marks on the file map).
- **Type**: Source Serif 4 for reading text and headlines (calm, bookish), Barlow Semi Condensed for
  labels and data (technical, compact). Fonts are bundled. Line length stays under 80 characters.
- **First answer**: the default view is the simple result: the preview beside a plain "Before you share" block (stacked on mobile). It
  summarises *categories* (an exact location, names and identifiers, dates, device and software, descriptions, embedded content, scripts or
  macros), says that common data is not automatically a problem, always shows a coverage line ("5 areas were only partly checked or not
  checked", with a link), and offers: the primary "Create experimental copy" (uses the recommended groups of the single selection state and
  names them), "Choose what to remove" (reveals the one options panel, which is closed until then, and moves focus to it) and "View full
  technical report". It holds no checkboxes (one selection state only), has no score, and never says a file is safe, clean or anonymous.
  PDF and DOCX get an honest inspect-only sentence and no copy action; JPEG/PNG with nothing removable say so and offer only the report.
- **Technical report**: a closed section that is not mounted while closed (findings, status legend, evidence, file map, SHA-256, detailed
  coverage). Opening moves focus to its heading, closing returns it to the button. Because it is not in the page, the browser's find-in-page
  does not see it until opened.
- **Copy result**: verdict, original and copy side by side (stacked on mobile), download, what is no longer detected and what remains
  detected, and the reminder to open the copy and keep the original. The ten checks, comparison table and manifest are folded (open
  automatically if a check failed).
- **Progressive disclosure**: the technical report is closed and unmounted by default; inside it SHA-256, status legend, file map, evidence
  and the structural category are folded again. Coverage is summarised on the simple view and detailed in the report. Internal links move
  focus, not only scroll. Nothing is sticky, so nothing can cover content at high zoom.
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
