import { ImageResponse } from "next/og";

export const alt = "Tflash — an AI workspace that speaks Somali and English";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Sharing card for the public landing page. Uses the same palette as the UI. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#201e1b",
          color: "#f3f6ec",
          padding: "58px 68px",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -180,
            right: -120,
            width: 560,
            height: 560,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(243,189,86,0.22), rgba(32,30,27,0) 68%)",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 15,
              background: "#f3bd56",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
              <rect fill="#201e1b" height="3.9" rx="1.95" width="19.2" x="6.4" y="7.6" />
              <path d="M20.5 11.5 12.2 20.1h3.7l-2.2 4.7 7.6-8.4h-3.7l2.9-4.9Z" fill="#201e1b" />
            </svg>
          </div>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Tflash
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
          <div
            style={{
              display: "flex",
              color: "#e0b968",
              fontSize: 18,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            Somali + English
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 18,
              maxWidth: 980,
              fontSize: 64,
              lineHeight: 1.08,
              letterSpacing: "-0.035em",
            }}
          >
            An AI workspace that
          </div>
          <div
            style={{
              display: "flex",
              maxWidth: 980,
              color: "#f3bd56",
              fontSize: 64,
              lineHeight: 1.08,
              letterSpacing: "-0.035em",
            }}
          >
            speaks your language.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 18,
            marginTop: 34,
            color: "#b5afa4",
            fontSize: 22,
          }}
        >
          <span>15 providers</span>
          <span style={{ color: "#6f6a62" }}>·</span>
          <span>10 connections</span>
          <span style={{ color: "#6f6a62" }}>·</span>
          <span>Approval-gated tools</span>
        </div>
      </div>
    ),
    size,
  );
}
