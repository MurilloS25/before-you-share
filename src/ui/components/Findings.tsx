import { CATEGORY_ORDER, type Category, type CoverageItem, type Finding } from '../../core/types';
import { CATEGORY_HINT, CATEGORY_LABEL, STATUS_HELP, STATUS_LABEL, describeLocation, plural } from '../lib/format';

const STATUS_MARK: Record<Finding['status'], string> = {
  verified: '•',
  inferred: '~',
  suspicious: '!',
  unsupported: '–',
  unavailable: '?',
};

export function StatusLabel({ status }: { status: Finding['status'] }) {
  return (
    <span class="status" data-status={status} title={STATUS_HELP[status]}>
      <span class="status-mark" aria-hidden="true">
        {STATUS_MARK[status]}
      </span>
      {STATUS_LABEL[status]}
    </span>
  );
}

function FindingItem({ f, onActive, active }: { f: Finding; onActive: (id: string | null) => void; active: boolean }) {
  const removal = f.transformation === 'removable' ? 'The experimental copy can remove this.' : f.transformation === 'preserved' ? 'The experimental copy keeps this on purpose.' : 'This tool cannot remove this.';
  return (
    <li
      class="finding"
      data-status={f.status}
      data-active={active || undefined}
      onMouseEnter={() => onActive(f.id)}
      onMouseLeave={() => onActive(null)}
      onFocusIn={() => onActive(f.id)}
      onFocusOut={() => onActive(null)}
    >
      <div class="finding-head">
        <h3 class="finding-label">{f.label}</h3>
        <StatusLabel status={f.status} />
      </div>
      {f.value !== null && f.value !== '' && <p class="finding-value">{f.value}</p>}
      <p class="finding-why">{f.privacyExplanation}</p>
      <details>
        <summary>Evidence and limits</summary>
        <dl class="evidence">
          <dt>Source</dt>
          <dd>{f.source}</dd>
          <dt>Location</dt>
          <dd>{describeLocation(f.location)}</dd>
          <dt>Status</dt>
          <dd>
            {STATUS_LABEL[f.status]}. {STATUS_HELP[f.status]}
          </dd>
          <dt>Confidence</dt>
          <dd>{f.confidence}</dd>
          <dt>Copy</dt>
          <dd>{removal}</dd>
          {f.limitations.length > 0 && (
            <>
              <dt>Limits</dt>
              <dd>
                <ul class="plain-list">
                  {f.limitations.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
      </details>
    </li>
  );
}

interface Props {
  findings: Finding[];
  activeId: string | null;
  onActive: (id: string | null) => void;
}

export function FindingsByCategory({ findings, activeId, onActive }: Props) {
  const groups = CATEGORY_ORDER.map((c) => ({ cat: c, items: findings.filter((f) => f.category === c) })).filter((g) => g.items.length > 0);
  if (groups.length === 0) {
    return <p class="empty">No hidden or notable items were found in the areas this tool reads. That does not mean the file has none; see what was not checked below.</p>;
  }
  return (
    <div class="categories">
      <nav aria-label="Jump to a category" class="category-nav">
        <ul class="plain-list inline-list">
          {groups.map((g) => (
            <li key={g.cat}>
              <a href={`#cat-${g.cat}`}>
                {CATEGORY_LABEL[g.cat]} <span class="count">{g.items.length}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {groups.map(({ cat, items }) => {
        const list = (
          <ul class="finding-list">
            {items.map((f) => (
              <FindingItem key={f.id} f={f} onActive={onActive} active={activeId === f.id} />
            ))}
          </ul>
        );
        return (
          <section class="category" id={`cat-${cat}`} key={cat} aria-labelledby={`cat-h-${cat}`} data-category={cat}>
            {cat === 'structural' ? (
              <>
                <h2 id={`cat-h-${cat}`} class="category-title">
                  {CATEGORY_LABEL[cat]} <span class="count">{items.length}</span>
                </h2>
                <details open={items.some((f) => f.status !== 'verified' || f.code === 'file.type-mismatch') || undefined}>
                  <summary>
                    Show {CATEGORY_LABEL[cat].toLowerCase()} items. {CATEGORY_HINT[cat]}
                  </summary>
                  {list}
                </details>
              </>
            ) : (
              <>
                <h2 id={`cat-h-${cat}`} class="category-title">
                  {CATEGORY_LABEL[cat]} <span class="count">{items.length}</span>
                </h2>
                <p class="category-hint">{CATEGORY_HINT[cat as Category]}</p>
                {list}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

const COVER_LABEL: Record<CoverageItem['state'], string> = { inspected: 'Inspected', partial: 'Partly inspected', 'not-inspected': 'Not inspected' };

export function CoverageList({ coverage }: { coverage: CoverageItem[] }) {
  const notFull = coverage.filter((c) => c.state !== 'inspected').length;
  return (
    <section class="coverage" aria-labelledby="coverage-h">
      <h2 id="coverage-h" class="section-title">
        What this tool did not fully check
      </h2>
      <p class="section-lead">
        {plural(notFull, 'area')} {notFull === 1 ? 'was' : 'were'} only partly read or not read. Other hidden information may remain in this file.
      </p>
      <ul class="coverage-list">
        {coverage.map((c, i) => (
          <li key={i} data-state={c.state}>
            <span class="coverage-area">{c.area}</span>
            <span class="coverage-state">{COVER_LABEL[c.state]}</span>
            <span class="coverage-note">{c.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
