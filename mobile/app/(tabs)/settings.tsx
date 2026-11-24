import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../lib/auth";
import { API_URL } from "../../lib/config";
import { colors } from "../../lib/theme";

export default function Settings() {
  const { signOut } = useAuth();
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Server</Text>
      <Text style={styles.value}>{API_URL}</Text>
      <Pressable onPress={signOut} style={styles.btn} accessibilityRole="button">
        <Text style={styles.btnText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 16, gap: 8 },
  label: { color: colors.muted, fontSize: 12, textTransform: "uppercase" },
  value: { color: colors.text, marginBottom: 24 },
  btn: { borderWidth: 1, borderColor: colors.danger, padding: 12, borderRadius: 8, alignItems: "center" },
  btnText: { color: colors.danger, fontWeight: "700" },
});
