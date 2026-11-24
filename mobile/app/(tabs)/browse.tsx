import { Link } from "expo-router";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { ErrorBanner, ListMessage } from "../../components";
import { api, type BrowseShow } from "../../lib/api";
import { colors } from "../../lib/theme";
import { useApi } from "../../lib/useApi";

export default function Browse() {
  const { data, setData, error, refreshing, refresh, token } = useApi(api.browse);

  async function toggleFollow(show: BrowseShow) {
    if (!token || !data) return;
    const next = !show.following;
    setData(data.map((s) => (s.id === show.id ? { ...s, following: next } : s)));
    try {
      if (next) await api.follow(token, show.id);
      else await api.unfollow(token, show.id);
    } catch {
      setData(data); // roll back the optimistic update
    }
  }

  return (
    <FlatList<BrowseShow>
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 12, gap: 8 }}
      data={data ?? []}
      keyExtractor={(s) => s.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      ListHeaderComponent={
        error && data && data.length > 0 ? (
          <ErrorBanner message="Couldn't refresh. Showing the last load." onRetry={() => void refresh()} />
        ) : undefined
      }
      ListEmptyComponent={
        <ListMessage
          message={error ? "Couldn't load shows." : data ? "No shows yet." : "Loading shows…"}
          detail={error ?? (data ? "Check back soon." : undefined)}
          onRetry={error ? () => void refresh() : undefined}
        />
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Link href={{ pathname: "/show/[token]", params: { token: item.rss_token, title: item.title } }} asChild>
            <Pressable style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              {item.description ? <Text style={styles.sub} numberOfLines={2}>{item.description}</Text> : null}
              <Text style={styles.meta}>{item.published_count} episodes</Text>
            </Pressable>
          </Link>
          <Pressable onPress={() => toggleFollow(item)} style={[styles.follow, item.following && styles.following]}>
            <Text style={[styles.followText, item.following && { color: colors.accent }]}>
              {item.following ? "Following" : "Follow"}
            </Text>
          </Pressable>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, padding: 14, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  title: { color: colors.text, fontWeight: "600", fontSize: 16 },
  sub: { color: colors.muted, marginTop: 4 },
  meta: { color: colors.muted, marginTop: 6, fontSize: 12 },
  follow: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.accent },
  following: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.accent },
  followText: { color: "#000", fontWeight: "700" },
});
