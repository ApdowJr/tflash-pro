import { ImageResponse } from "next/og";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export default function AppleIcon() {
  return new ImageResponse(
    <svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <rect width="44" height="44" rx="12" fill="#202620" />
      <path d="M10 11.5h25l-2.8 5.2H23l-2.25 4.55h6.45L13 33.3l3.55-8.35H12.2l4.45-8.25H10v-5.2Z" fill="#d2f377" />
    </svg>, size,
  );
}
