import { Link } from "expo-router";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { LegalLinks } from "../../components";
import { useAuth } from "../../lib/auth";
import { API_URL } from "../../lib/config";
import { useTheme } from "../../lib/theme-context";
import type { ThemePreference } from "../../lib/theme";

const THEME_CHOICES: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function Settings() {
  const { signOut, token } = useAuth();
  const { colors: c, preference, setPreference } = useTheme();

  function deleteAccount() {
    Alert.alert(
      "Delete account",
      "This permanently deletes your account, tokens, and your content. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: async () => {
            if (!token) return;
            try {
              const res = await fetch(`${API_URL}/api/me`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { error?: string };
                Alert.alert("Unable to delete account", body.error || `Request failed (${res.status})`);
                return;
              }
              await signOut();
            } catch (err) {
              Alert.alert("Unable to delete account", err instanceof Error ? err.message : String(err));
            }
          },
        },
      ],
    );
  }

  return (
    <View style={[styles.wrap, { backgroundColor: c.bg }]}>
      <Text style={[styles.label, { color: c.muted }]}>Appearance</Text>
      <View style={styles.themeRow}>
        {THEME_CHOICES.map((choice) => {
          const active = preference === choice.value;
          return (
            <Pressable
              key={choice.value}
              onPress={() => setPreference(choice.value)}
              style={[styles.themeBtn, { borderColor: active ? c.accent : c.border, backgroundColor: active ? c.card : "transparent" }]}
              accessibilityRole="button"
              accessibilityLabel={`${choice.label} theme`}
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.themeText, { color: active ? c.accent : c.muted }]}>{choice.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.label, { color: c.muted }]}>Server</Text>
      <Text style={[styles.value, { color: c.text }]}>{API_URL}</Text>

      <Link href="/about" asChild>
        <Pressable style={[styles.neutralBtn, { borderColor: c.border }]} accessibilityRole="link" accessibilityLabel="About NEON">
          <Text style={[styles.neutralText, { color: c.text }]}>About NEON</Text>
        </Pressable>
      </Link>

      <Text style={[styles.label, styles.section, { color: c.muted }]}>Legal</Text>
      <LegalLinks />

      <Text style={[styles.label, styles.section, { color: c.muted }]}>Account</Text>
      <Pressable onPress={signOut} style={[styles.btn, { borderColor: c.danger }]} accessibilityRole="button">
        <Text style={[styles.btnText, { color: c.danger }]}>Sign out</Text>
      </Pressable>
      <Pressable onPress={deleteAccount} style={[styles.btn, { borderColor: c.danger }]} accessibilityRole="button">
        <Text style={[styles.btnText, { color: c.danger }]}>Delete account</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 8 },
  label: { fontSize: 12, textTransform: "uppercase" },
  value: {},
  section: { marginTop: 16 },
  themeRow: { flexDirection: "row", gap: 8 },
  themeBtn: { flex: 1, borderWidth: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  themeText: { fontWeight: "700" },
  neutralBtn: { borderWidth: 1, padding: 12, borderRadius: 8, alignItems: "center", marginTop: 16 },
  neutralText: { fontWeight: "700" },
  btn: { borderWidth: 1, padding: 12, borderRadius: 8, alignItems: "center" },
  btnText: { fontWeight: "700" },
});
