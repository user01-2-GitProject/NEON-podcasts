import Constants from "expo-constants";
import { StyleSheet, Text, View } from "react-native";
import { LegalLinks } from "../components";
import { colors } from "../lib/theme";

export default function About() {
  const name = Constants.expoConfig?.name ?? "NEON";
  const version = Constants.expoConfig?.version ?? "unknown";

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.description}>Listen to NEON podcasts, follow shows, and join live rooms on the go.</Text>
        <Text style={styles.version}>Version {version}</Text>
      </View>
      <Text style={styles.label}>Legal</Text>
      <LegalLinks />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 16, gap: 12 },
  card: { backgroundColor: colors.card, padding: 16, borderRadius: 10, gap: 8 },
  name: { color: colors.text, fontWeight: "700", fontSize: 22 },
  description: { color: colors.text },
  version: { color: colors.muted, fontSize: 13 },
  label: { color: colors.muted, fontSize: 12, textTransform: "uppercase" },
});
