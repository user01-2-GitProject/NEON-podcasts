"use client";

import { useEffect, useState } from "react";
import { THEME_KEY, resolveTheme, type Theme } from "@/lib/theme";

// Header button that flips between the cream (light) and navy (dark) themes.
// Until someone picks, the app follows the system setting, live.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as Theme) || "dark");
    const media = matchMedia("(prefers-color-scheme: light)");
    const follow = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem(THEME_KEY); } catch {}
      if (saved) return;
      const next = resolveTheme(null, media.matches);
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  function flip() {
    const next: Theme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    setTheme(next);
  }

  const label = theme === "light" ? "Switch to the dark theme" : "Switch to the light theme";
  return (
    <button type="button" className="theme-toggle" onClick={flip} aria-label={label} title={label}>
      {/* Until mounted the theme isn't known; keep the box so the header doesn't jump. */}
      <span aria-hidden="true">{theme === null ? "" : theme === "light" ? "☾" : "☀"}</span>
    </button>
  );
}
