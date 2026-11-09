"use client";

import {
  Component,
  lazy,
  Suspense,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

/**
 * Mount a code-split panel without letting a chunk failure take down the page.
 *
 * `React.lazy` turns a failed dynamic import into a render error. Because the
 * nearest error boundary used to be the route-level one, a single unloadable
 * chunk — a stale deployment replacing hashed files, a dropped connection, a
 * proxy or CDN error — replaced the whole workspace with "this screen could not
 * load". React also caches the rejected import for the lifetime of the module,
 * so the route screen's "try again" could not recover without a full reload.
 *
 * This wrapper keeps the failure inside the panel: the caller's compact
 * fallback stays on screen, the failure copy explains what happened, and the
 * reader gets an in-place retry (a fresh `lazy()` and a fresh import attempt)
 * as well as a page reload for the case where the module map keeps the
 * rejection.
 */

type PanelErrorBoundaryProps = {
  readonly children: ReactNode;
  /** Rendered instead of the panel after a failure; receives the retry action. */
  readonly failure: (retry: () => void) => ReactNode;
  readonly label: string;
  readonly onRetry: () => void;
};

type PanelErrorBoundaryState = { readonly failed: boolean };

class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): PanelErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Full detail stays in the client console for support; the panel shows
    // only safe, localized copy.
    console.error("[tflash] workspace panel failed", this.props.label, error);
  }

  render() {
    if (this.state.failed) return this.props.failure(this.props.onRetry);
    return this.props.children;
  }
}

export function LazyPanel<P extends object>({
  load,
  render,
  fallback,
  failure,
  label,
}: {
  /** Must be a stable module-scope importer so the chunk is requested once. */
  readonly load: () => Promise<{ readonly default: ComponentType<P> }>;
  readonly render: (Component: ComponentType<P>) => ReactNode;
  readonly fallback: ReactNode;
  readonly failure: (retry: () => void) => ReactNode;
  readonly label: string;
}) {
  const [attempt, setAttempt] = useState(0);
  // A new `lazy()` per attempt is what makes "try again" meaningful: reusing
  // the original component would replay the rejected import promise instead of
  // requesting the chunk again.
  const Chunk = useMemo(() => lazy(load), [load, attempt]);
  return (
    <PanelErrorBoundary
      failure={failure}
      key={attempt}
      label={label}
      onRetry={() => setAttempt((current) => current + 1)}
    >
      <Suspense fallback={fallback}>{render(Chunk)}</Suspense>
    </PanelErrorBoundary>
  );
}
