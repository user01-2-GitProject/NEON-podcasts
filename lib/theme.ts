// E1: light (cream) and dark (navy) brand themes. The choice lives on
// <html data-theme>, saved in localStorage; with no saved choice the
// system preference decides. app/globals.css holds the colors.

export type Theme = "light" | "dark";
export const THEME_KEY = "neon-theme";

export function resolveTheme(stored: string | null | undefined, prefersLight: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return prefersLight ? "light" : "dark";
}

// Runs in <head> before the first paint so the page never flashes the
// wrong theme. Kept tiny and self-contained (it can't import anything).
export const themeInitScript = `(function(){try{var s=localStorage.getItem(${JSON.stringify(THEME_KEY)});var t=s==="light"||s==="dark"?s:(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}})()`;
