import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import {
  normalizePreference,
  THEME_STORAGE_KEY,
  themeFor,
  themes,
  type ThemeColors,
  type ThemeName,
  type ThemePreference,
} from "./theme";

type ThemeState = {
  theme: ThemeName;
  colors: ThemeColors;
  preference: ThemePreference;
  setPreference: (value: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    let live = true;
    SecureStore.getItemAsync(THEME_STORAGE_KEY)
      .then((saved) => {
        if (live) setPreferenceState(normalizePreference(saved));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const setPreference = useCallback((value: ThemePreference) => {
    const next = normalizePreference(value);
    setPreferenceState(next);
    SecureStore.setItemAsync(THEME_STORAGE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo<ThemeState>(() => {
    const theme = themeFor(preference, system);
    return { theme, colors: themes[theme], preference, setPreference };
  }, [preference, system, setPreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
