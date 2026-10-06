import { Component, type ComponentChild, type ComponentType, type FunctionComponent } from 'preact';

/**
 * Skip re-rendering a hook-free function component when its props are shallowly equal. A few lines of core Preact,
 * so `preact/compat` (which rewires event handling globally) is not needed.
 */
export function memo<P extends object>(Fn: FunctionComponent<P>): ComponentType<P> {
  return class Memo extends Component<P> {
    override shouldComponentUpdate(next: P): boolean {
      const a = this.props as Record<string, unknown>;
      const b = next as Record<string, unknown>;
      const keys = Object.keys(b);
      if (keys.length !== Object.keys(a).length) return true;
      return keys.some((k) => a[k] !== b[k]);
    }
    override render(props: P): ComponentChild {
      return Fn(props);
    }
  };
}
