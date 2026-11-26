import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { ListMessage } from "../../components";
import { ShowName } from "../../components/OfficialBadge";
import { useDownloads, type DownloadedEpisode } from "../../lib/downloads";
import { usePlayer } from "../../lib/player";
import { colors } from "../../lib/theme";

export default function Downloads() {
  const { downloads, remove } = useDownloads();
  const { play, current } = usePlayer();

  return (
    <FlatList<DownloadedEpisode>
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 12, gap: 8 }}
      data={downloads}
      keyExtractor={(d) => d.episode.id}
      ListEmptyComponent={
        <ListMessage message="Nothing downloaded yet." detail="Download an episode to listen offline." />
      }
      renderItem={({ item: { episode } }) => (
        <View style={[styles.card, current?.id === episode.id && { borderColor: colors.accent }]}>
          <Pressable onPress={() => play(episode)} style={{ flex: 1 }}>
            <Text style={styles.title}>{episode.title}</Text>
            <ShowName official={episode.show_is_official} style={styles.sub}>
              {episode.show_title}
              {episode.published_at ? ` · ${new Date(episode.published_at).toLocaleDateString()}` : ""}
            </ShowName>
          </Pressable>
          <Pressable
            onPress={() => remove(episode.id)}
            style={styles.btn}
            accessibilityRole="button"
            accessibilityLabel="Delete download"
          >
            <Text style={styles.btnText}>Delete</Text>
          </Pressable>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  title: { color: colors.text, fontWeight: "600", fontSize: 16 },
  sub: { color: colors.muted, marginTop: 4 },
  btn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.danger },
  btnText: { color: colors.danger, fontWeight: "700", fontSize: 13 },
});
