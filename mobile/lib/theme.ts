// E4: the mobile half of E1's two themes, straight from BRAND.md.
// Pure helpers live here (no React Native imports) so they can be tested
// offline; theme-context.tsx owns the device preference and persistence.

export type ThemeName = "light" | "dark";
export type ThemePreference = ThemeName | "system";

export type ThemeColors = {
  bg: string;
  card: string;
  text: string;
  heading: string;
  muted: string;
  accent: string;
  onAccent: string;
  border: string;
  hairline: string;
  softGold: string;
  danger: string;
};

export const themes: Record<ThemeName, ThemeColors> = {
  light: {
    bg: "#F9F2E2",
    card: "#FFFBF2",
    text: "#183341",
    heading: "#183341",
    muted: "#55666E",
    accent: "#3D5A7E",
    onAccent: "#F9F2E2",
    border: "#DFD1B4",
    hairline: "#A8895E",
    softGold: "#D9C79A",
    danger: "#A3332B",
  },
  dark: {
    bg: "#183341",
    card: "#1E3D4D",
    text: "#F9F2E2",
    heading: "#F9F2E2",
    muted: "#B9C3C5",
    accent: "#D9C79A",
    onAccent: "#183341",
    border: "#36586A",
    hairline: "#A8895E",
    softGold: "#D9C79A",
    danger: "#FF9A8F",
  },
};

// Kept for screens not yet converted to useTheme(); also the safe default
// before the provider resolves the device setting.
export const colors: ThemeColors = themes.dark;

export const THEME_STORAGE_KEY = "neon_theme";

export function normalizePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function themeFor(preference: ThemePreference, system: ThemeName | null | undefined): ThemeName {
  return preference === "system" ? (system === "light" ? "light" : "dark") : preference;
}
