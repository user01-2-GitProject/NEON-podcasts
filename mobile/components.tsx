import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePlayer } from "./lib/player";
import { colors } from "./lib/theme";

export function MiniPlayer() {
  const { current, playing, toggle } = usePlayer();
  if (!current) return null;
  return (
    <View style={styles.bar}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{current.title}</Text>
        <Text style={styles.sub} numberOfLines={1}>{current.show_title}</Text>
      </View>
      <Pressable onPress={toggle} style={styles.btn} accessibilityRole="button" accessibilityLabel={playing ? "Pause" : "Play"}>
        <Text style={styles.btnText}>{playing ? "Pause" : "Play"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", padding: 12, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: "#222" },
  title: { color: colors.text, fontWeight: "600" },
  sub: { color: colors.muted, fontSize: 12 },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.accent },
  btnText: { color: "#000", fontWeight: "700" },
});
