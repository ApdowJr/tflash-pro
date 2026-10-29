import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@fontsource/dm-serif-display/400.css";
import "@fontsource/dm-serif-display/400-italic.css";
import "@fontsource/dm-mono/400.css";
import "./globals.css";

const DESCRIPTION =
  "A focused AI workspace for chat and your connected tools.";

export const metadata: Metadata = {
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
    title: "Tflash",
    type: "website",
  },
  twitter: {
    card: "summary",
    description: DESCRIPTION,
    title: "Tflash",
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

// Applies the saved theme before hydration so the first paint never flashes.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('tflash:theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a className="tf-skip-link" href="#main-content">Skip to main content · U gudub nuxurka</a>
        <TooltipProvider>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
