import { CATEGORY_ORDER, type Category, type CoverageItem, type Finding } from '../../core/types';
import { CATEGORY_HINT, CATEGORY_LABEL, STATUS_HELP, STATUS_LABEL, describeLocation, plural } from '../lib/format';
import { memo } from '../lib/memo';
import { useMemo } from 'preact/hooks';
import { goTo } from '../lib/nav';
import { LazyDetails, ShowMore } from './Disclosure';

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

const FindingItem = memo(function FindingItem({ f, active }: { f: Finding; active: boolean }) {
  const removal = f.transformation === 'removable' ? 'The experimental copy can remove this.' : f.transformation === 'preserved' ? 'The experimental copy keeps this on purpose.' : 'This tool cannot remove this.';
  // Hover and focus tracking is delegated to the list (see FindingsByCategory): no handlers per item.
  return (
    <li class="finding" data-id={f.id} data-status={f.status} data-active={active || undefined}>
      <div class="finding-head">
        <h3 class="finding-label">{f.label}</h3>
        <StatusLabel status={f.status} />
      </div>
      {f.value !== null && f.value !== '' && <p class="finding-value">{f.value}</p>}
      <p class="finding-why">{f.privacyExplanation}</p>
      <LazyDetails summary="Evidence and limits">
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
      </LazyDetails>
    </li>
  );
});

interface Props {
  findings: Finding[];
  activeId: string | null;
  onActive: (id: string | null) => void;
}

const findingId = (e: Event): string | null => ((e.target as HTMLElement | null)?.closest?.('li.finding') as HTMLElement | null)?.dataset['id'] ?? null;

/** Id of the finding that currently holds keyboard focus inside `group`, if any. */
function focusedId(group: Element | null): string | null {
  const active = document.activeElement;
  if (!group || !active || !group.contains(active)) return null;
  return ((active.closest('li.finding') as HTMLElement | null)?.dataset['id']) ?? null;
}

const isLimitNotice = (f: Finding): boolean => f.code === 'limit.findings' || /\.limit$/.test(f.code);

export function FindingsByCategory({ findings, activeId, onActive }: Props) {
  const groups = useMemo(
    () =>
      CATEGORY_ORDER.map((c) => ({
        cat: c,
        // Notices that the analysis stopped at a limit come first, so they are never behind "Show more".
        items: findings.filter((f) => f.category === c).sort((a, b) => Number(isLimitNotice(b)) - Number(isLimitNotice(a))),
      })).filter((g) => g.items.length > 0),
    [findings],
  );
  if (groups.length === 0) {
    return <p class="empty">No hidden or notable items were found in the areas this tool reads. That does not mean the file has none; see what was not checked below.</p>;
  }
  return (
    <div class="categories">
      <nav aria-label="Jump to a category" class="category-nav">
        <ul class="plain-list inline-list">
          {groups.map((g) => (
            <li key={g.cat}>
              <a
                href={`#cat-h-${g.cat}`}
                onClick={(e) => {
                  e.preventDefault();
                  goTo(`cat-h-${g.cat}`);
                }}
              >
                {CATEGORY_LABEL[g.cat]} <span class="count">{g.items.length}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {groups.map(({ cat, items }) => {
        const list = (
          <div
            class="finding-group"
            onMouseOver={(e) => onActive(findingId(e))}
            onMouseLeave={(e) => onActive(focusedId(e.currentTarget as Element))}
            onFocusIn={(e) => onActive(findingId(e))}
            onFocusOut={(e) => {
              const group = e.currentTarget as Element;
              const next = e.relatedTarget as Element | null;
              onActive(next && group.contains(next) ? (((next.closest('li.finding') as HTMLElement | null)?.dataset['id']) ?? null) : null);
            }}
          >
            <ShowMore items={items} id={`list-${cat}`} listClass="finding-list" noun={['finding', 'findings']} render={(f) => <FindingItem key={f.id} f={f} active={activeId === f.id} />} />
          </div>
        );
        return (
          <section class="category" id={`cat-${cat}`} key={cat} aria-labelledby={`cat-h-${cat}`} data-category={cat}>
            <h2 id={`cat-h-${cat}`} class="category-title">
              {CATEGORY_LABEL[cat]} <span class="count">{items.length}</span>
            </h2>
            {cat === 'structural' ? (
              <LazyDetails summary={`Show ${CATEGORY_LABEL[cat].toLowerCase()} items. ${CATEGORY_HINT[cat]}`} open={items.some((f) => f.status !== 'verified' || f.code === 'file.type-mismatch')}>
                {list}
              </LazyDetails>
            ) : (
              <>
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
