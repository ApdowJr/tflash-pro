"use client";

import { useLayoutEffect } from "react";

export function ThemeInitializer() {
  useLayoutEffect(() => {
    try {
      const theme = window.localStorage.getItem("tflash:theme");
      const resolved = theme === "dark" || theme === "light" ? theme : theme === "system" ? "system" : "dark";
      if (resolved === "system") {
        document.documentElement.removeAttribute("data-theme");
        document.documentElement.style.removeProperty("color-scheme");
      } else {
        document.documentElement.dataset.theme = resolved;
        document.documentElement.style.colorScheme = resolved;
      }
    } catch {
      // Browser storage can be unavailable.
    }
  }, []);

  return null;
}
