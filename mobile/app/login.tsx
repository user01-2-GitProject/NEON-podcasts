import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../lib/auth";
import { GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from "../lib/config";
import { colors } from "../lib/theme";

WebBrowser.maybeCompleteAuthSession();

export default function Login() {
  const { signInWithGoogleIdToken } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
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

  return (
    <View style={styles.wrap}>
      <Text style={styles.logo}>NEON</Text>
      <Text style={styles.tag}>Your shows, in your pocket.</Text>
      {busy ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <Pressable
          disabled={!request}
          onPress={() => {
            setError(null);
            promptAsync();
          }}
          style={[styles.btn, !request && { opacity: 0.5 }]}
          accessibilityRole="button"
        >
          <Text style={styles.btnText}>Sign in with Google</Text>
        </Pressable>
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
  error: { color: colors.danger, textAlign: "center" },
});
