"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary: it replaces the root layout, so it must render its own
 * `<html>`/`<body>` and cannot rely on the app stylesheet having loaded. Styles
 * are inline for that reason.
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error("[tflash] root error", error.digest ?? "no-digest", error.message);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fdfcfb",
          color: "#1c1a18",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <main style={{ maxWidth: "26rem", padding: "2rem", lineHeight: 1.55 }}>
          <p style={{ fontSize: "0.7rem", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.6 }}>
            Tflash
          </p>
          <h1 style={{ fontSize: "1.4rem", margin: "0.4rem 0 0.6rem" }}>
            The app could not start
          </h1>
          <p style={{ margin: "0 0 1.25rem", fontSize: "0.9rem", opacity: 0.75 }}>
            A critical error stopped the page from loading entirely. Reload to try again; if the
            message repeats, the deployment needs attention.
          </p>
          <button
            onClick={reset}
            style={{
              border: "1px solid #d8d4cf",
              background: "#fff",
              borderRadius: "0.5rem",
              padding: "0.5rem 0.9rem",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
            type="button"
          >
            Reload · Dib u soo celi
          </button>
          {error.digest ? (
            <p style={{ marginTop: "1rem", fontSize: "0.7rem", opacity: 0.5, fontFamily: "ui-monospace, monospace" }}>
              digest: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
