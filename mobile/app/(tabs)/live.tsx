import { Link } from "expo-router";
import { useCallback } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { api, type LiveSession } from "../../lib/api";
import { colors } from "../../lib/theme";
import { useApi } from "../../lib/useApi";

// The list route returns metadata only; presence is on each session detail.
type SessionRow = LiveSession & { participant_count: number | null };

function statusLabel(status: LiveSession["status"]): string {
  if (status === "live") return "LIVE";
  if (status === "scheduled") return "Scheduled";
  return "Ended";
}

export default function LiveSessions() {
  const load = useCallback(async (token: string): Promise<SessionRow[]> => {
    const sessions = await api.listLiveSessions(token);
    return Promise.all(
      sessions.map(async (session) => {
        try {
          const detail = await api.getLiveSession(token, session.id);
          return { ...session, participant_count: detail.participants.length };
        } catch {
          // The count is optional; a failed detail fetch shouldn't hide the row.
          return { ...session, participant_count: null };
        }
      }),
    );
  }, []);
  const { data, error, refreshing, refresh, token } = useApi(load);

  if (!token) {
    return <CenteredMessage text="Sign in to see live sessions." />;
  }

  return (
    <FlatList<SessionRow>
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 12, gap: 8 }}
      data={data ?? []}
      keyExtractor={(session) => session.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.intro}>Scheduled and live podcasts. Open one to join the room.</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={
        <CenteredMessage
          text={error ?? (data ? "No live sessions yet. Check back soon." : "Loading sessions…")}
        />
      }
      renderItem={({ item: session }) => (
        <View style={styles.card}>
          <Link
            href={{ pathname: "/live/[id]", params: { id: session.id, title: session.title } }}
            asChild
          >
            <Pressable style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel={`Open ${session.title}`}>
              <Text style={styles.title} numberOfLines={2}>{session.title}</Text>
              <View style={styles.metaRow}>
                <Text style={[styles.tag, session.status === "live" && styles.liveTag]}>
                  {statusLabel(session.status)}
                </Text>
                <Text style={styles.meta}>{participantLabel(session.participant_count)}</Text>
                <Text style={styles.meta}>· max {session.max_participants}</Text>
              </View>
            </Pressable>
          </Link>
        </View>
      )}
    />
  );
}

function participantLabel(count: number | null): string {
  if (count === null) return "participants —";
  return `${count} participant${count === 1 ? "" : "s"}`;
}

function CenteredMessage({ text }: { text: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.empty}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: 6, marginBottom: 4 },
  intro: { color: colors.muted },
  error: { color: colors.danger },
  card: { backgroundColor: colors.card, padding: 14, borderRadius: 10 },
  title: { color: colors.text, fontWeight: "600", fontSize: 16 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" },
  tag: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  liveTag: { color: colors.accent },
  meta: { color: colors.muted, fontSize: 12 },
  center: { alignItems: "center", justifyContent: "center", paddingTop: 48 },
  empty: { color: colors.muted, textAlign: "center" },
});
