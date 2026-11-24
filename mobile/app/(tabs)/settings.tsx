import { Link } from "expo-router";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { LegalLinks } from "../../components";
import { useAuth } from "../../lib/auth";
import { API_URL } from "../../lib/config";
import { colors } from "../../lib/theme";

export default function Settings() {
  const { signOut, token } = useAuth();

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
    <View style={styles.wrap}>
      <Text style={styles.label}>Server</Text>
      <Text style={styles.value}>{API_URL}</Text>

      <Link href="/about" asChild>
        <Pressable style={styles.neutralBtn} accessibilityRole="link" accessibilityLabel="About NEON">
          <Text style={styles.neutralText}>About NEON</Text>
        </Pressable>
      </Link>

      <Text style={[styles.label, styles.section]}>Legal</Text>
      <LegalLinks />

      <Text style={[styles.label, styles.section]}>Account</Text>
      <Pressable onPress={signOut} style={styles.btn} accessibilityRole="button">
        <Text style={styles.btnText}>Sign out</Text>
      </Pressable>
      <Pressable onPress={deleteAccount} style={styles.btn} accessibilityRole="button">
        <Text style={styles.btnText}>Delete account</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 16, gap: 8 },
  label: { color: colors.muted, fontSize: 12, textTransform: "uppercase" },
  value: { color: colors.text },
  section: { marginTop: 16 },
  neutralBtn: { borderWidth: 1, borderColor: "#2c2c3a", padding: 12, borderRadius: 8, alignItems: "center", marginTop: 16 },
  neutralText: { color: colors.text, fontWeight: "700" },
  btn: { borderWidth: 1, borderColor: colors.danger, padding: 12, borderRadius: 8, alignItems: "center" },
  btnText: { color: colors.danger, fontWeight: "700" },
});
