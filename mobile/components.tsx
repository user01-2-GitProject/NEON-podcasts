import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { FeedEpisode } from "./lib/api";
import { PRIVACY_URL, TERMS_URL } from "./lib/config";
import { useDownloads } from "./lib/downloads";
import { usePlayer } from "./lib/player";
import { useTheme } from "./lib/theme-context";
import { ShowName } from "./components/OfficialBadge";

// Download toggle for an episode row: Download → 42% (in flight) → Saved.
export function DownloadButton({ episode }: { episode: FeedEpisode }) {
  const { status, download } = useDownloads();
  const { colors: c } = useTheme();
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
      style={[styles.dl, { borderColor: s.state === "downloaded" ? c.accent : c.muted }]}
      accessibilityRole="button"
      accessibilityLabel={s.state === "none" ? "Download episode" : s.state === "downloading" ? "Downloading" : "Downloaded"}
    >
      <Text style={[styles.dlText, { color: s.state === "downloaded" ? c.accent : c.text }]}>{label}</Text>
    </Pressable>
  );
}

// Compact player bar above the tab navigator. The full branded card lives in
// components/Player.tsx and appears on the show screen.
export function MiniPlayer() {
  const { current, playing, toggle, seekBy } = usePlayer();
  const { colors: c } = useTheme();
  if (!current) return null;
  return (
    <View style={[styles.bar, { backgroundColor: c.card, borderTopColor: c.hairline }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>{current.title}</Text>
        <ShowName official={current.show_is_official} style={[styles.sub, { color: c.muted }]}>{current.show_title}</ShowName>
      </View>
      <Pressable onPress={() => seekBy(-15)} style={styles.skip} accessibilityRole="button" accessibilityLabel="Back 15 seconds">
        <Text style={[styles.skipText, { color: c.text }]}>⟲15</Text>
      </Pressable>
      <Pressable onPress={toggle} style={[styles.btn, { backgroundColor: c.accent }]} accessibilityRole="button" accessibilityLabel={playing ? "Pause" : "Play"}>
        <Text style={[styles.btnText, { color: c.onAccent }]}>{playing ? "Pause" : "Play"}</Text>
      </Pressable>
      <Pressable onPress={() => seekBy(15)} style={styles.skip} accessibilityRole="button" accessibilityLabel="Forward 15 seconds">
        <Text style={[styles.skipText, { color: c.text }]}>15⟳</Text>
      </Pressable>
    </View>
  );
}

// Legal links shared by Settings and About. https works in Expo Go (no native
// module or custom scheme needed).
export function LegalLinks() {
  const { colors: c } = useTheme();
  function open(url: string) {
    void Linking.openURL(url).catch(() => Alert.alert("Couldn't open link", "Open it in a browser instead."));
  }

  return (
    <View style={styles.legal}>
      <Pressable onPress={() => open(PRIVACY_URL)} style={styles.legalRow} accessibilityRole="link" accessibilityLabel="Privacy Policy">
        <Text style={[styles.legalText, { color: c.text }]}>Privacy Policy</Text>
      </Pressable>
      <Pressable onPress={() => open(TERMS_URL)} style={styles.legalRow} accessibilityRole="link" accessibilityLabel="Terms">
        <Text style={[styles.legalText, { color: c.text }]}>Terms</Text>
      </Pressable>
    </View>
  );
}

// Shown above a stale list when a refresh fails (the empty-state message is
// used when there is nothing to show at all).
export function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { colors: c } = useTheme();
  return (
    <View style={[styles.errorBanner, { backgroundColor: c.card }]}>
      <Text style={[styles.errorText, { color: c.danger }]}>{message}</Text>
      <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Try again">
        <Text style={[styles.errorRetry, { color: c.accent }]}>Try again</Text>
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
  const { colors: c } = useTheme();
  return (
    <View style={styles.message}>
      <Text style={[styles.messageTitle, { color: c.text }]}>{message}</Text>
      {detail ? <Text style={[styles.messageDetail, { color: c.muted }]}>{detail}</Text> : null}
      {onRetry ? (
        <Pressable onPress={onRetry} style={[styles.retry, { borderColor: c.accent }]} accessibilityRole="button" accessibilityLabel="Try again">
          <Text style={[styles.retryText, { color: c.accent }]}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  legal: { gap: 4 },
  legalRow: { paddingVertical: 8 },
  legalText: { fontWeight: "600" },
  errorBanner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 10, borderRadius: 8, marginBottom: 8 },
  errorText: { flexShrink: 1 },
  errorRetry: { fontWeight: "700" },
  message: { alignItems: "center", justifyContent: "center", paddingTop: 48, paddingHorizontal: 24, gap: 8 },
  messageTitle: { fontWeight: "600", textAlign: "center" },
  messageDetail: { textAlign: "center", fontSize: 13 },
  retry: { marginTop: 4, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  retryText: { fontWeight: "700" },
  bar: { flexDirection: "row", alignItems: "center", padding: 12, borderTopWidth: 1 },
  title: { fontWeight: "600" },
  sub: { fontSize: 12 },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  btnText: { fontWeight: "700" },
  skip: { paddingHorizontal: 8, paddingVertical: 8 },
  skipText: { fontWeight: "600", fontSize: 13 },
  dl: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, minWidth: 84, alignItems: "center" },
  dlText: { fontWeight: "600", fontSize: 13 },
});
