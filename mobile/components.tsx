import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { FeedEpisode } from "./lib/api";
import { PRIVACY_URL, TERMS_URL } from "./lib/config";
import { useDownloads } from "./lib/downloads";
import { usePlayer } from "./lib/player";
import { colors } from "./lib/theme";
import { ShowName } from "./components/OfficialBadge";

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
        <ShowName official={current.show_is_official} style={styles.sub}>{current.show_title}</ShowName>
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

// Legal links shared by Settings and About. https works in Expo Go (no native
// module or custom scheme needed).
export function LegalLinks() {
  function open(url: string) {
    void Linking.openURL(url).catch(() => Alert.alert("Couldn't open link", "Open it in a browser instead."));
  }

  return (
    <View style={styles.legal}>
      <Pressable onPress={() => open(PRIVACY_URL)} style={styles.legalRow} accessibilityRole="link" accessibilityLabel="Privacy Policy">
        <Text style={styles.legalText}>Privacy Policy</Text>
      </Pressable>
      <Pressable onPress={() => open(TERMS_URL)} style={styles.legalRow} accessibilityRole="link" accessibilityLabel="Terms">
        <Text style={styles.legalText}>Terms</Text>
      </Pressable>
    </View>
  );
}

// Shown above a stale list when a refresh fails (the empty-state message is
// used when there is nothing to show at all).
export function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
      <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Try again">
        <Text style={styles.errorRetry}>Try again</Text>
      </Pressable>
    </View>
  );
}

// Friendly list placeholder for empty, loading and failed fetches.
export function ListMessage({
  message,
  detail,
  onRetry,
}: {
  message: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.message}>
      <Text style={styles.messageTitle}>{message}</Text>
      {detail ? <Text style={styles.messageDetail}>{detail}</Text> : null}
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.retry} accessibilityRole="button" accessibilityLabel="Try again">
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  legal: { gap: 4 },
  legalRow: { paddingVertical: 8 },
  legalText: { color: colors.text, fontWeight: "600" },
  errorBanner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, backgroundColor: colors.card, padding: 10, borderRadius: 8, marginBottom: 8 },
  errorText: { color: colors.danger, flexShrink: 1 },
  errorRetry: { color: colors.accent, fontWeight: "700" },
  message: { alignItems: "center", justifyContent: "center", paddingTop: 48, paddingHorizontal: 24, gap: 8 },
  messageTitle: { color: colors.text, fontWeight: "600", textAlign: "center" },
  messageDetail: { color: colors.muted, textAlign: "center", fontSize: 13 },
  retry: { marginTop: 4, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.accent },
  retryText: { color: colors.accent, fontWeight: "700" },
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
