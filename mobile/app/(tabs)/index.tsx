import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { DownloadButton, ErrorBanner, ListMessage } from "../../components";
import { ShowName } from "../../components/OfficialBadge";
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
      ListHeaderComponent={
        error && data && data.length > 0 ? (
          <ErrorBanner message="Couldn't refresh. Showing the last load." onRetry={() => void refresh()} />
        ) : undefined
      }
      ListEmptyComponent={
        <ListMessage
          message={error ? "Couldn't load your feed." : data ? "Nothing to play yet." : "Loading your feed…"}
          detail={error ?? (data ? "Follow a show in Browse to see episodes here." : undefined)}
          onRetry={error ? () => void refresh() : undefined}
        />
      }
      renderItem={({ item }) => (
        <View style={[styles.card, current?.id === item.id && { borderColor: colors.accent }]}>
          <Pressable onPress={() => play(item)} disabled={!item.audio_url} style={{ flex: 1 }}>
            <Text style={styles.title}>{item.title}</Text>
            <ShowName official={item.show_is_official} style={styles.sub}>
              {item.show_title}
              {item.published_at ? ` · ${new Date(item.published_at).toLocaleDateString()}` : ""}
            </ShowName>
          </Pressable>
          <DownloadButton episode={item} />
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
});

