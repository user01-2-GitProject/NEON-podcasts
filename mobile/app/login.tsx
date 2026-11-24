import * as Google from "expo-auth-session/providers/google";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../lib/auth";
import { API_URL, GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from "../lib/config";
import { colors } from "../lib/theme";

WebBrowser.maybeCompleteAuthSession();

// Native Google sign-in needs per-platform OAuth client IDs; without them (e.g. in Expo Go)
// the browser sign-in below is the way in.
const NATIVE_GOOGLE_READY = Boolean(GOOGLE_IOS_CLIENT_ID || GOOGLE_ANDROID_CLIENT_ID);

export default function Login() {
  const { signInWithGoogleIdToken, signInWithToken } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID ?? "unset",
    androidClientId: GOOGLE_ANDROID_CLIENT_ID ?? "unset",
    webClientId: GOOGLE_WEB_CLIENT_ID,
  });

  useEffect(() => {
    if (response?.type !== "success") return;
    const idToken = response.params.id_token;
    if (!idToken) {
      setError("Google did not return an ID token");
      return;
    }
    setBusy(true);
    signInWithGoogleIdToken(idToken)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Sign-in failed"))
      .finally(() => setBusy(false));
  }, [response, signInWithGoogleIdToken]);

  // Opens the NEON website, where the user signs in with Google as usual and taps
  // "Connect app"; the site redirects back to this app's deep link with a token.
  async function signInWithBrowser() {
    setError(null);
    const redirect = Linking.createURL("auth");
    const url = `${API_URL}/mobile-connect?redirect=${encodeURIComponent(redirect)}`;
    const result = await WebBrowser.openAuthSessionAsync(url, redirect);
    if (result.type !== "success") return;
    const token = Linking.parse(result.url).queryParams?.token;
    if (typeof token !== "string") {
      setError("Sign-in did not return a token");
      return;
    }
    setBusy(true);
    try {
      await signInWithToken(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.logo}>NEON</Text>
      <Text style={styles.tag}>Your shows, in your pocket.</Text>
      {busy ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <Pressable onPress={signInWithBrowser} style={styles.btn} accessibilityRole="button">
            <Text style={styles.btnText}>Sign in with Google</Text>
          </Pressable>
          {NATIVE_GOOGLE_READY ? (
            <Pressable
              disabled={!request}
              onPress={() => {
                setError(null);
                promptAsync();
              }}
              style={[styles.alt, !request && { opacity: 0.5 }]}
              accessibilityRole="button"
            >
              <Text style={styles.altText}>Use native Google sign-in</Text>
            </Pressable>
          ) : null}
        </>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: 24, gap: 16 },
  logo: { color: colors.accent, fontSize: 48, fontWeight: "900", letterSpacing: 6 },
  tag: { color: colors.muted, marginBottom: 24 },
  btn: { backgroundColor: colors.accent, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 10 },
  btnText: { color: "#000", fontWeight: "700", fontSize: 16 },
  alt: { paddingHorizontal: 16, paddingVertical: 10 },
  altText: { color: colors.muted, textDecorationLine: "underline" },
  error: { color: colors.danger, textAlign: "center" },
});
