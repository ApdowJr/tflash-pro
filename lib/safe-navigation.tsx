"use client";

import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import Link from "next/link";
import { useCallback, useContext, type ComponentProps } from "react";

/**
 * Navigates via Next.js App Router when mounted under a router context, and falls
 * back to `window.location.assign` when components are rendered standalone (e.g. unit tests).
 */
export function useSafeNavigate() {
  const router = useContext(AppRouterContext);
  return useCallback(
    (href: string) => {
      if (router) {
        router.push(href);
        return;
      }
      window.location.assign(href);
    },
    [router],
  );
}

/**
 * Renders Next.js `<Link>` when an App Router context is present, and falls back
 * to a plain `<a>` when mounted standalone in tests without a router or `self` polyfill.
 */
export function SafeLink({
  href,
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { readonly href: string }) {
  const router = useContext(AppRouterContext);
  if (!router) {
    const {
      replace: _replace,
      scroll: _scroll,
      shallow: _shallow,
      prefetch: _prefetch,
      locale: _locale,
      passHref: _passHref,
      legacyBehavior: _legacyBehavior,
      onNavigate: _onNavigate,
      ...anchorProps
    } = props as Record<string, unknown>;
    return (
      <a href={href} {...(anchorProps as ComponentProps<"a">)}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} {...props}>
      {children}
    </Link>
  );
}
