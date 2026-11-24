import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { API_URL } from "./config";

const TOKEN_KEY = "neon_api_token";

type AuthState = {
  token: string | null;
  loading: boolean;
  signInWithGoogleIdToken: (idToken: string) => Promise<void>;
  signInWithToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    SecureStore.getItemAsync(TOKEN_KEY)
      .then(setToken)
      .finally(() => setLoading(false));
  }, []);

  // Exchanges a Google ID token for a per-user NEON API token (Phase 3a backend route).
  const signInWithGoogleIdToken = useCallback(async (idToken: string) => {
    const res = await fetch(`${API_URL}/api/auth/mobile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: idToken }),
    });
    const body = (await res.json().catch(() => null)) as { token?: string; error?: string } | null;
    if (!res.ok || !body?.token) throw new Error(body?.error ?? `Sign-in failed (${res.status})`);
    await SecureStore.setItemAsync(TOKEN_KEY, body.token);
    setToken(body.token);
  }, []);

  // Stores a token handed back by the browser sign-in (/mobile-connect).
  const signInWithToken = useCallback(async (raw: string) => {
    if (!/^npt_[0-9a-f]{64}$/i.test(raw)) throw new Error("Sign-in returned an invalid token");
    await SecureStore.setItemAsync(TOKEN_KEY, raw);
    setToken(raw);
  }, []);

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setToken(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, loading, signInWithGoogleIdToken, signInWithToken, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
