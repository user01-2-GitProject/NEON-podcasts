import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../lib/auth";
import { DownloadsProvider } from "../lib/downloads";
import { PlayerProvider } from "../lib/player";
import { registerPushToken } from "../lib/push";
import { colors } from "../lib/theme";

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

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="about" options={{ title: "About NEON" }} />
      <Stack.Screen name="show/[token]" options={{ title: "Show" }} />
      <Stack.Screen name="live/[id]" options={{ title: "Live session" }} />
    </Stack>
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
      <AuthProvider>
        <PushRegistration />
        <DownloadsProvider>
          <PlayerProvider>
            <StatusBar style="light" />
            <AuthGate />
          </PlayerProvider>
        </DownloadsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
