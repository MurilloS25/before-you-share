import { useEffect, useRef, useState } from 'preact/hooks';
import type { AnalysisReport } from '../../core/types';
import { STATUS_HELP, STATUS_LABEL } from '../lib/format';
import { LazyDetails } from './Disclosure';
import { FileMap } from './FileMap';
import { CoverageList, FindingsByCategory } from './Findings';
import { Identification } from './Identification';

interface Props {
  report: AnalysisReport;
  name: string;
  open: boolean;
  onToggle: (open: boolean) => void;
}

/**
 * Everything technical: identification, findings by category with evidence, the status legend, the file map and the
 * detailed coverage. Closed by default and not built while closed, so a result with hundreds of findings costs one
 * heading and one button until the person asks for it. The browser's find-in-page cannot see the closed content.
 */
export function TechnicalReport({ report, name, open, onToggle }: Props) {
  // Highlighting a finding on the map only concerns the report, so it is kept here and never re-renders the rest of the screen.
  const [activeId, onActive] = useState<string | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const wasOpen = useRef(open);

  // Focus follows the disclosure: to the report heading when it opens, back to the button when it closes.
  useEffect(() => {
    if (open && !wasOpen.current) heading.current?.focus();
    if (!open && wasOpen.current) toggle.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <section class="tech-report" id="report" aria-labelledby="report-h">
      <div class="report-bar">
        <h2 id="report-h" class="section-title" ref={heading} tabIndex={-1}>
          Technical report
        </h2>
        <button type="button" id="report-toggle" ref={toggle} class="button" aria-expanded={open} aria-controls={open ? 'report-body' : undefined} onClick={() => onToggle(!open)}>
          {open ? 'Hide technical report' : 'Open technical report'}
        </button>
      </div>
      {!open && <p class="fine-print">The full list of findings with their evidence, the file map, the SHA-256 and the detailed coverage. Open the report to see them.</p>}
      {open && (
        <div id="report-body" class="report-body">
          <Identification name={name} fingerprint={report.fingerprint} report={report} />
          <section aria-labelledby="findings-h" class="findings-section">
            <h2 id="findings-h" class="section-title">
              Findings
            </h2>
            <p class="legend">
              Each finding says where it was read from and how sure the tool is. <em>Suspicious</em> means unusual or inconsistent, not harmful. Open “Evidence and limits” on any item
              for the location and caveats.
            </p>
            <details class="tech-details">
              <summary>How to read the status labels</summary>
              <dl class="status-legend">
                {(['verified', 'inferred', 'suspicious', 'unsupported', 'unavailable'] as const).map((s) => (
                  <div key={s}>
                    <dt>{STATUS_LABEL[s]}</dt>
                    <dd>{STATUS_HELP[s]}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <LazyDetails class="tech-details" summary="Where findings sit in the file (map of byte positions)">
              <FileMap findings={report.findings} fileSize={report.fingerprint.size} activeId={activeId} />
            </LazyDetails>
            <FindingsByCategory findings={report.findings} activeId={activeId} onActive={onActive} />
          </section>
          <CoverageList coverage={report.coverage} />
        </div>
      )}
    </section>
  );
}
