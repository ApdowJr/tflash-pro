import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ConnectivityBanner } from "@/components/app/connectivity-banner";
import { ThemeInitializer } from "@/components/theme-initializer";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@fontsource/dm-serif-display/400.css";
import "@fontsource/dm-serif-display/400-italic.css";
import "@fontsource/dm-mono/400.css";
import "./globals.css";

const DESCRIPTION =
  "A bilingual AI workspace for chat, research and finished work — Somali and English.";

const SITE_URL = process.env.APP_URL?.trim().replace(/\/+$/, "") || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Tflash",
    template: "%s · Tflash",
  },
  description: DESCRIPTION,
  applicationName: "Tflash",
  appleWebApp: {
    capable: true,
    title: "Tflash",
  },
  openGraph: {
    description: DESCRIPTION,
    siteName: "Tflash",
    title: "Tflash — an AI workspace for Somali and English",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    description: DESCRIPTION,
    title: "Tflash — an AI workspace for Somali and English",
    images: [{
      url: "/opengraph-image",
      width: 1200,
      height: 630,
      alt: "Tflash — an AI workspace that speaks Somali and English",
    }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // `cover` opts into env(safe-area-inset-*) on iOS so the composer and the
  // sidebar clear the home indicator instead of sitting under it.
  viewportFit: "cover",
  // Keep the layout height in sync with the on-screen keyboard on Android.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfcfb" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1a18" },
  ],
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeInitializer />
        <ConnectivityBanner />
        <a className="tf-skip-link" href="#main-content">Skip to main content · U gudub nuxurka</a>
        <TooltipProvider>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
