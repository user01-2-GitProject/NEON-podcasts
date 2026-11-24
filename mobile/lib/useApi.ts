import { useCallback, useEffect, useState } from "react";
import { UnauthorizedError } from "./api";
import { useAuth } from "./auth";

// Loads data with the stored token; a 401 signs the user out (token revoked or expired).
export function useApi<T>(load: (token: string) => Promise<T>) {
  const { token, signOut } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    setError(null);
    try {
      setData(await load(token));
    } catch (e) {
      if (e instanceof UnauthorizedError) await signOut();
      else setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setRefreshing(false);
    }
  }, [token, load, signOut]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, setData, error, refreshing, refresh, token };
}
