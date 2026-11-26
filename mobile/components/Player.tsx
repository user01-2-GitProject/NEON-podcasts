import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { absoluteUrl, type FeedEpisode } from "../lib/api";
import { displayFont } from "../lib/fonts";
import { usePlayer } from "../lib/player";
import { useTheme } from "../lib/theme-context";
import { ShowName } from "./OfficialBadge";

// The branded "now playing" card: cream card on navy (or navy-on-cream in the
// light theme), a Didone title, gold hairlines, and the orbit-N stamp on the
// artwork of official shows. The stamp is 18% of the artwork width with a 4%
// inset, per BRAND.md's cover-art rule.
export function PlayerCard({ episode }: { episode: FeedEpisode }) {
  const { playing, toggle, seekBy } = usePlayer();
  const { colors: c } = useTheme();
  const artwork = episode.show_image_url ? absoluteUrl(episode.show_image_url) : null;

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]} accessibilityLabel="Now playing">
      <Text style={[styles.eyebrow, { color: c.muted }]}>Now playing</Text>
      <View style={styles.body}>
        <View style={styles.artWrap}>
          {artwork ? (
            <Image source={{ uri: artwork }} style={styles.art} accessibilityLabel={`${episode.show_title} artwork`} />
          ) : (
            <View style={[styles.art, { backgroundColor: c.bg }]} />
          )}
          {episode.show_is_official ? (
            <Image
              source={require("../assets/neon-official.gif")}
              style={styles.stamp}
              accessibilityLabel="NEON official show"
            />
          ) : null}
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: c.heading, fontFamily: displayFont }]} numberOfLines={2}>{episode.title}</Text>
          <View style={[styles.hairline, { backgroundColor: c.hairline }]} />
          <ShowName official={episode.show_is_official} style={[styles.show, { color: c.muted }]}>
            {episode.show_title}
          </ShowName>
        </View>
      </View>
      <View style={styles.controls}>
        <Pressable onPress={() => seekBy(-15)} style={[styles.skip, { borderColor: c.hairline }]} accessibilityRole="button" accessibilityLabel="Back 15 seconds">
          <Text style={[styles.skipText, { color: c.text }]}>⟲15</Text>
        </Pressable>
        <Pressable onPress={toggle} style={[styles.play, { backgroundColor: c.accent }]} accessibilityRole="button" accessibilityLabel={playing ? "Pause" : "Play"}>
          <Text style={[styles.playText, { color: c.onAccent }]}>{playing ? "Pause" : "Play"}</Text>
        </Pressable>
        <Pressable onPress={() => seekBy(15)} style={[styles.skip, { borderColor: c.hairline }]} accessibilityRole="button" accessibilityLabel="Forward 15 seconds">
          <Text style={[styles.skipText, { color: c.text }]}>15⟳</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 1.4, textTransform: "uppercase" },
  body: { flexDirection: "row", alignItems: "center", gap: 14 },
  artWrap: { position: "relative", width: 96, height: 96 },
  art: { width: "100%", height: "100%", borderRadius: 8 },
  stamp: { position: "absolute", width: "18%", height: "18%", right: "4%", bottom: "4%", resizeMode: "contain" },
  copy: { flex: 1, gap: 6 },
  title: { fontSize: 21, fontWeight: "600" },
  hairline: { height: 1, width: "100%" },
  show: { fontSize: 13 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 2 },
  skip: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8 },
  skipText: { fontWeight: "600", fontSize: 13 },
  play: { paddingHorizontal: 22, paddingVertical: 9, borderRadius: 8 },
  playText: { fontWeight: "700" },
});
