import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#1B1814",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <svg fill="none" height="152" viewBox="0 0 32 32" width="152">
        <rect fill="#1B1814" height="32" rx="8.5" width="32" />
        <rect fill="#F2B23F" height="3.9" rx="1.95" width="19.2" x="6.4" y="7.6" />
        <path d="M20.5 11.5 12.2 20.1h3.7l-2.2 4.7 7.6-8.4h-3.7l2.9-4.9Z" fill="#F2B23F" />
      </svg>
    </div>,
    size,
  );
}
