import type { AnalysisReport, Fingerprint } from '../../core/types';
import type { Detection } from '../../core/detect';
import { displayText } from '../../core/bytes';
import { FORMAT_LABEL, formatBytes } from '../lib/format';

const CHECK: Record<Fingerprint['extensionCheck'], string> = {
  match: 'Matches the content',
  mismatch: 'Does not match the content',
  unknown: 'Not available',
};

interface Props {
  name: string;
  fingerprint: Fingerprint;
  report?: AnalysisReport;
  detection?: Detection;
}

export function Identification({ name, fingerprint, report, detection }: Props) {
  const label = report ? FORMAT_LABEL[report.format] : (detection?.label ?? 'Unrecognised content');
  const support = report
    ? report.format === 'pdf'
      ? 'Inspection only'
      : report.copyRefusal
        ? 'Inspection only for this file'
        : 'Inspection and experimental copy'
    : 'Not supported';
  return (
    <section class="identification" aria-labelledby="ident-h">
      <h2 id="ident-h" class="section-title">
        Identification
      </h2>
      <dl class="facts">
        <div>
          <dt>Detected from content</dt>
          <dd>{label}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>
            {formatBytes(fingerprint.size)} ({fingerprint.size.toLocaleString('en-US')} bytes)
          </dd>
        </div>
        <div>
          <dt>Support in this tool</dt>
          <dd>{support}</dd>
        </div>
        <div>
          <dt>File name</dt>
          <dd class="user-text">{displayText(name, 200)}</dd>
        </div>
      </dl>
      <details class="tech-details">
        <summary>Technical details: extension, reported type, SHA-256</summary>
        <dl class="facts">
        <div>
          <dt>Extension</dt>
          <dd>{fingerprint.extension ? `.${fingerprint.extension}: ${CHECK[fingerprint.extensionCheck]}` : 'None'}</dd>
        </div>
        <div>
          <dt>Type reported by the browser</dt>
          <dd class="user-text">{displayText(fingerprint.declaredType, 100) || 'None'}</dd>
        </div>
        {fingerprint.sha256 && (
          <div class="fact-wide">
            <dt>SHA-256 of the bytes</dt>
            <dd>
              <code class="hash">{fingerprint.sha256}</code>
              <span class="fact-note"> Identifies these exact bytes, for example to confirm two copies are the same. It says nothing about whether the file is safe.</span>
            </dd>
          </div>
        )}
        </dl>
        <p class="fine-print">The name and these values are held in memory for this tab only and are not stored or logged.</p>
      </details>
    </section>
  );
}
