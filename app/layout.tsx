import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppSettingsProvider } from "@/components/app/settings-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ururka Agent — chat on any AI provider",
  description:
    "A modern eve agent workspace with OpenRouter, OpenAI, Anthropic, Gemini, Groq, local models and more.",
  applicationName: "Ururka Agent",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
};

// Applies the saved theme before hydration so the first paint never flashes.
const THEME_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem('ururka:settings:v1')||'{}');if(s.theme==='dark'||s.theme==='light'){document.documentElement.dataset.theme=s.theme;document.documentElement.style.colorScheme=s.theme;}}catch(e){}})();`;

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
