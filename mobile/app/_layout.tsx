import "../sentry"; // production-only Sentry init (no-op without a DSN)
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../lib/auth";
import { DownloadsProvider } from "../lib/downloads";
import { PlayerProvider } from "../lib/player";
import { registerPushToken } from "../lib/push";
import { useTheme, ThemeProvider } from "../lib/theme-context";

function AuthGate() {
  const { token, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const onLogin = segments[0] === "login";
    if (!token && !onLogin) router.replace("/login");
    else if (token && onLogin) router.replace("/");
  }, [token, loading, segments, router]);

  const { colors: c, theme } = useTheme();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  return (
    <>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.text,
          contentStyle: { backgroundColor: c.bg },
        }}
      >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="about" options={{ title: "About NEON" }} />
      <Stack.Screen name="show/[token]" options={{ title: "Show" }} />
      <Stack.Screen name="live/[id]" options={{ title: "Live session" }} />
      </Stack>
    </>
  );
}

// Registers the device for push once per signed-in token (also on app restart
// with a stored token). registerPushToken is a no-op on web / Expo Go and
// swallows its own errors, so this never affects navigation.
function PushRegistration() {
  const { token } = useAuth();
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!token || registeredFor.current === token) return;
    registeredFor.current = token;
    void registerPushToken(token);
  }, [token]);

  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <PushRegistration />
          <DownloadsProvider>
            <PlayerProvider>
              <AuthGate />
            </PlayerProvider>
          </DownloadsProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
