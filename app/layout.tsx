import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppSettingsProvider } from "@/components/settings/app-settings";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const DESCRIPTION =
  "T Flash is a fast AI workspace: bring OpenRouter, OpenAI, Anthropic, Gemini, Groq or a local model, then switch between them mid-conversation.";

export const metadata: Metadata = {
  title: {
    default: "T Flash",
    template: "%s · T Flash",
  },
  description: DESCRIPTION,
  applicationName: "T Flash",
  appleWebApp: {
    capable: true,
    title: "T Flash",
  },
  openGraph: {
    description: DESCRIPTION,
    title: "T Flash",
    type: "website",
  },
  twitter: {
    card: "summary",
    description: DESCRIPTION,
    title: "T Flash",
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
const THEME_SCRIPT = `(function(){try{var k='tflash:settings:v1',r=localStorage.getItem(k)||localStorage.getItem('ururka:settings:v1')||'{}',s=JSON.parse(r);if(s.theme==='dark'||s.theme==='light'){document.documentElement.dataset.theme=s.theme;document.documentElement.style.colorScheme=s.theme;}}catch(e){}})();`;

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <TooltipProvider>
          <AppSettingsProvider>{children}</AppSettingsProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
