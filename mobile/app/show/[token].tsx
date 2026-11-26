import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { DownloadButton } from "../../components";
import { OfficialBadge } from "../../components/OfficialBadge";
import { absoluteUrl, showByToken, type FeedEpisode } from "../../lib/api";
import { usePlayer } from "../../lib/player";
import { colors } from "../../lib/theme";
import { useApi } from "../../lib/useApi";

export default function ShowScreen() {
  const { token: rssToken, title } = useLocalSearchParams<{ token: string; title?: string }>();
  const load = useCallback((t: string) => showByToken(t, rssToken), [rssToken]);
  const { data, error, refreshing, refresh } = useApi(load);
  const { play, current } = usePlayer();

  return (
    <>
      <Stack.Screen
        options={{
          title: data?.show.title ?? title ?? "Show",
          headerTitle: data?.show.is_official
            ? () => (
                <View style={styles.headerTitle}>
                  <OfficialBadge size={24} />
                  <Text style={styles.headerTitleText} numberOfLines={1}>{data.show.title}</Text>
                </View>
              )
            : undefined,
        }}
      />
      <FlatList<FeedEpisode>
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        data={data?.episodes ?? []}
        keyExtractor={(e) => e.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
        ListHeaderComponent={
          data?.show.image_url || data?.show.description ? (
            <View style={styles.header}>
              {data.show.image_url ? (
                <Image source={{ uri: absoluteUrl(data.show.image_url) }} style={styles.art} accessibilityLabel={`${data.show.title} artwork`} />
              ) : null}
              {data.show.description ? <Text style={styles.desc}>{data.show.description}</Text> : null}
            </View>
          ) : undefined
        }
        ListEmptyComponent={<Text style={styles.empty}>{error ?? (data ? "No episodes yet." : "")}</Text>}
        renderItem={({ item }) => (
          <View style={[styles.card, current?.id === item.id && { borderColor: colors.accent }]}>
            <Pressable onPress={() => play(item)} disabled={!item.audio_url} style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              {item.published_at ? <Text style={styles.sub}>{new Date(item.published_at).toLocaleDateString()}</Text> : null}
            </Pressable>
            <DownloadButton episode={item} />
          </View>
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", gap: 12, marginBottom: 8 },
  art: { width: 180, height: 180, borderRadius: 12, backgroundColor: colors.card },
  desc: { color: colors.muted, alignSelf: "stretch" },
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
  headerTitle: { flexDirection: "row", alignItems: "center", maxWidth: 260 },
  headerTitleText: { color: colors.text, fontWeight: "600", fontSize: 17, flexShrink: 1 },
  sub: { color: colors.muted, marginTop: 4 },
  empty: { color: colors.muted, textAlign: "center", marginTop: 48 },
});
