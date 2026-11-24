import { Pressable, StyleSheet, Text, View } from "react-native";
import type { FeedEpisode } from "./lib/api";
import { useDownloads } from "./lib/downloads";
import { usePlayer } from "./lib/player";
import { colors } from "./lib/theme";

// Download toggle for an episode row: Download → 42% (in flight) → Saved.
export function DownloadButton({ episode }: { episode: FeedEpisode }) {
  const { status, download } = useDownloads();
  const s = status(episode.id);
  if (!episode.audio_url && s.state === "none") return null;
  const label =
    s.state === "downloaded"
      ? "Saved"
      : s.state === "downloading"
        ? s.progress === null
          ? "…"
          : `${Math.round(s.progress * 100)}%`
        : "Download";
  return (
    <Pressable
      onPress={() => download(episode)}
      disabled={s.state !== "none"}
      style={[styles.dl, s.state === "downloaded" && { borderColor: colors.accent }]}
      accessibilityRole="button"
      accessibilityLabel={s.state === "none" ? "Download episode" : s.state === "downloading" ? "Downloading" : "Downloaded"}
    >
      <Text style={[styles.dlText, s.state === "downloaded" && { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

export function MiniPlayer() {
  const { current, playing, toggle, seekBy } = usePlayer();
  if (!current) return null;
  return (
    <View style={styles.bar}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{current.title}</Text>
        <Text style={styles.sub} numberOfLines={1}>{current.show_title}</Text>
      </View>
      <Pressable onPress={() => seekBy(-15)} style={styles.skip} accessibilityRole="button" accessibilityLabel="Back 15 seconds">
        <Text style={styles.skipText}>⟲15</Text>
      </Pressable>
      <Pressable onPress={toggle} style={styles.btn} accessibilityRole="button" accessibilityLabel={playing ? "Pause" : "Play"}>
        <Text style={styles.btnText}>{playing ? "Pause" : "Play"}</Text>
      </Pressable>
      <Pressable onPress={() => seekBy(15)} style={styles.skip} accessibilityRole="button" accessibilityLabel="Forward 15 seconds">
        <Text style={styles.skipText}>15⟳</Text>
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
  skip: { paddingHorizontal: 8, paddingVertical: 8 },
  skipText: { color: colors.text, fontWeight: "600", fontSize: 13 },
  dl: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.muted, minWidth: 84, alignItems: "center" },
  dlText: { color: colors.text, fontWeight: "600", fontSize: 13 },
});
