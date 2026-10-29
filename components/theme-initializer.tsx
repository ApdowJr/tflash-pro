"use client";

import { useLayoutEffect } from "react";

export function ThemeInitializer() {
  useLayoutEffect(() => {
    try {
      const theme = window.localStorage.getItem("tflash:theme");
      if (theme === "dark" || theme === "light") {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.colorScheme = theme;
      }
    } catch {
      // Browser storage can be unavailable.
    }
  }, []);

  return null;
}
