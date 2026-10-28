import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@fontsource-variable/dm-sans";
import "@fontsource/dm-serif-display/400.css";
import "@fontsource/dm-serif-display/400-italic.css";
import "@fontsource/dm-mono/400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tflash — make space for better ideas",
  description: "A thoughtful AI workspace. Bring your own models and get to work.",
  applicationName: "Tflash",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9f5" },
    { media: "(prefers-color-scheme: dark)", color: "#161a17" },
  ],
};

const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('tflash:theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body><TooltipProvider>{children}</TooltipProvider></body>
    </html>
  );
}
