import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { DownloadButton } from "../../components";
import { OfficialBadge } from "../../components/OfficialBadge";
import { PlayerCard } from "../../components/Player";
import { absoluteUrl, showByToken, type FeedEpisode } from "../../lib/api";
import { displayFont } from "../../lib/fonts";
import { usePlayer } from "../../lib/player";
import { useTheme } from "../../lib/theme-context";
import { useApi } from "../../lib/useApi";

export default function ShowScreen() {
  const { token: rssToken, title } = useLocalSearchParams<{ token: string; title?: string }>();
  const load = useCallback((t: string) => showByToken(t, rssToken), [rssToken]);
  const { data, error, refreshing, refresh } = useApi(load);
  const { play, current } = usePlayer();
  const { colors: c } = useTheme();

  return (
    <>
      <Stack.Screen
        options={{
          title: data?.show.title ?? title ?? "Show",
          headerTitle: data?.show.is_official
            ? () => (
                <View style={styles.headerTitle}>
                  <OfficialBadge size={24} />
                  <Text style={[styles.headerTitleText, { color: c.text, fontFamily: displayFont }]} numberOfLines={1}>{data.show.title}</Text>
                </View>
              )
            : undefined,
        }}
      />
      <FlatList<FeedEpisode>
        style={{ backgroundColor: c.bg }}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        data={data?.episodes ?? []}
        keyExtractor={(e) => e.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.accent} />}
        ListHeaderComponent={
          <>
            {data?.show.image_url || data?.show.description ? (
              <View style={styles.header}>
                {data.show.image_url ? (
                  <View style={styles.artWrap}>
                    <Image source={{ uri: absoluteUrl(data.show.image_url) }} style={styles.art} accessibilityLabel={`${data.show.title} artwork`} />
                    {data.show.is_official ? (
                      <Image
                        source={require("../../assets/neon-official.gif")}
                        style={styles.stamp}
                        accessibilityLabel="NEON official show"
                      />
                    ) : null}
                  </View>
                ) : null}
                <Text style={[styles.showTitle, { color: c.heading, fontFamily: displayFont }]}>{data?.show.title ?? title ?? "Show"}</Text>
                <View style={[styles.hairline, { backgroundColor: c.hairline }]} />
                {data.show.description ? <Text style={[styles.desc, { color: c.muted }]}>{data.show.description}</Text> : null}
              </View>
            ) : null}
            {current ? <PlayerCard episode={current} /> : null}
          </>
        }
        ListEmptyComponent={<Text style={[styles.empty, { color: c.muted }]}>{error ?? (data ? "No episodes yet." : "")}</Text>}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: c.card }, current?.id === item.id && { borderColor: c.accent }]}>
            <Pressable onPress={() => play(item)} disabled={!item.audio_url} style={{ flex: 1 }}>
              <Text style={[styles.title, { color: c.text }]}>{item.title}</Text>
              {item.published_at ? <Text style={[styles.sub, { color: c.muted }]}>{new Date(item.published_at).toLocaleDateString()}</Text> : null}
            </Pressable>
            <DownloadButton episode={item} />
          </View>
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", gap: 10, marginBottom: 10 },
  artWrap: { position: "relative", width: 180, height: 180 },
  art: { width: "100%", height: "100%", borderRadius: 12 },
  stamp: { position: "absolute", width: "18%", height: "18%", right: "4%", bottom: "4%", resizeMode: "contain" },
  showTitle: { fontSize: 28, fontWeight: "600", textAlign: "center" },
  hairline: { height: 1, width: "70%" },
  desc: { alignSelf: "stretch", textAlign: "center" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  title: { fontWeight: "600", fontSize: 16 },
  headerTitle: { flexDirection: "row", alignItems: "center", maxWidth: 260 },
  headerTitleText: { fontWeight: "600", fontSize: 17, flexShrink: 1 },
  sub: { marginTop: 4 },
  empty: { textAlign: "center", marginTop: 48 },
});
