import { FlatList, Pressable, RefreshControl, StyleSheet, Text } from "react-native";
import { api, type FeedEpisode } from "../../lib/api";
import { usePlayer } from "../../lib/player";
import { colors } from "../../lib/theme";
import { useApi } from "../../lib/useApi";

export default function Following() {
  const { data, error, refreshing, refresh } = useApi(api.following);
  const { play, current } = usePlayer();

  return (
    <FlatList<FeedEpisode>
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 12, gap: 8 }}
      data={data ?? []}
      keyExtractor={(e) => e.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      ListEmptyComponent={
        <Text style={styles.empty}>{error ?? (data ? "Follow a show in Browse to see episodes here." : "")}</Text>
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => play(item)}
          disabled={!item.audio_url}
          style={[styles.card, current?.id === item.id && { borderColor: colors.accent }]}
        >
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.sub}>
            {item.show_title}
            {item.published_at ? ` · ${new Date(item.published_at).toLocaleDateString()}` : ""}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: "transparent" },
  title: { color: colors.text, fontWeight: "600", fontSize: 16 },
  sub: { color: colors.muted, marginTop: 4 },
  empty: { color: colors.muted, textAlign: "center", marginTop: 48 },
});

