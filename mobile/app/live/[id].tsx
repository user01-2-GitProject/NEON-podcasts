import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from "react-native";
import {
  api,
  UnauthorizedError,
  type LiveParticipant,
  type LivePostKind,
  type LiveSession,
  type LiveTurn,
} from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { colors } from "../../lib/theme";

const TURN_POLL_MS = 2500;
const SESSION_POLL_MS = 5000;
const HEARTBEAT_MS = 30000; // the API marks a participant away after 60 s of silence
const MAX_TURNS = 200;
const MAX_NAME = 40;
const MAX_TEXT = 4000;

function statusLabel(status: LiveSession["status"] | undefined): string {
  if (status === "live") return "LIVE";
  if (status === "scheduled") return "Scheduled";
  if (status === "ended") return "Ended";
  return "—";
}

export default function LiveSessionScreen() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const { token, signOut } = useAuth();

  const [session, setSession] = useState<LiveSession | null>(null);
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [joined, setJoined] = useState(false);
  const [me, setMe] = useState<LiveParticipant | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [chatText, setChatText] = useState("");
  const [speechText, setSpeechText] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Intervals must not close over stale state.
  const lastSeqRef = useRef(0);
  const joinedRef = useRef(false);
  const meRef = useRef<LiveParticipant | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);

  const setJoinedState = useCallback((value: boolean) => {
    joinedRef.current = value;
    setJoined(value);
  }, []);
  const setMeState = useCallback((value: LiveParticipant | null) => {
    meRef.current = value;
    setMe(value);
  }, []);

  const report = useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) {
        setError("Session expired. Sign in again.");
        void signOut();
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    },
    [signOut],
  );

  const applyTurns = useCallback((incoming: LiveTurn[]) => {
    const fresh = incoming
      .filter((turn) => turn.seq > lastSeqRef.current)
      .sort((a, b) => a.seq - b.seq);
    if (fresh.length === 0) return;
    lastSeqRef.current = fresh[fresh.length - 1].seq;
    setTurns((previous) => [...previous, ...fresh].slice(-MAX_TURNS));
  }, []);

  const refreshSession = useCallback(
    async (t: string) => {
      const data = await api.getLiveSession(t, id);
      setSession(data.session);
      setParticipants(data.participants);
      if (meRef.current) {
        const own = data.participants.find((p) => p.id === meRef.current?.id) ?? null;
        if (!own) setJoinedState(false); // left or removed from another client
        setMeState(own);
      }
    },
    [id, setJoinedState, setMeState],
  );

  const pollTurns = useCallback(
    async (t: string) => {
      const incoming = await api.getTurns(t, id, lastSeqRef.current);
      applyTurns(incoming);
    },
    [id, applyTurns],
  );

  // Full (re)load, also used by pull-to-refresh.
  const reload = useCallback(
    async (t: string) => {
      setLoading(true);
      setError(null);
      try {
        await refreshSession(t);
        lastSeqRef.current = 0;
        setTurns([]);
        await pollTurns(t);
        // A heartbeat is the only read-ish way to learn whether this token is
        // already present. A 404 simply means "not joined".
        try {
          await api.heartbeatLive(t, id);
          setJoinedState(true);
        } catch (err) {
          if (err instanceof UnauthorizedError) report(err);
          else {
            setJoinedState(false);
            setMeState(null);
          }
        }
      } catch (err) {
        report(err);
      } finally {
        setLoading(false);
      }
    },
    [refreshSession, pollTurns, id, setJoinedState, setMeState, report],
  );

  useEffect(() => {
    if (turns.length === 0) return;
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [turns.length]);

  useEffect(() => {
    if (!token) return;
    void reload(token);

    const turnTimer = setInterval(() => {
      void pollTurns(token).catch(report);
    }, TURN_POLL_MS);
    const sessionTimer = setInterval(() => {
      void refreshSession(token).catch(report);
    }, SESSION_POLL_MS);
    const heartbeatTimer = setInterval(() => {
      if (!joinedRef.current) return;
      void api.heartbeatLive(token, id).catch((err: unknown) => {
        if (err instanceof UnauthorizedError) report(err);
      });
    }, HEARTBEAT_MS);

    return () => {
      clearInterval(turnTimer);
      clearInterval(sessionTimer);
      clearInterval(heartbeatTimer);
    };
  }, [token, id, reload, pollTurns, refreshSession, report]);

  async function refresh() {
    if (!token) return;
    setRefreshing(true);
    try {
      await reload(token);
    } finally {
      setRefreshing(false);
    }
  }

  async function join() {
    if (!token || !session || session.status !== "live" || !displayName.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const participant = await api.joinLive(token, id, displayName.trim());
      setMeState(participant);
      setJoinedState(true);
      setNotice(`Joined as ${participant.display_name}.`);
      await refreshSession(token);
      await pollTurns(token);
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!token) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.leaveLive(token, id);
      setJoinedState(false);
      setMeState(null);
      setNotice("You left. Your turns stay in the transcript.");
      await refreshSession(token);
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  // Speech is allowed only for a host or guest who is not muted (server rule).
  const canSpeak = me !== null && (me.role === "host" || me.role === "guest") && !me.muted;

  async function submitTurn(kind: LivePostKind, text: string) {
    const value = text.trim();
    if (!token || !value || !joinedRef.current || session?.status !== "live") return;
    if (kind === "speech" && !canSpeak) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.postTurn(token, id, kind, value.slice(0, MAX_TEXT));
      if (kind === "speech") setSpeechText("");
      else setChatText("");
      setNotice(kind === "speech" ? "Speech queued." : "Chat posted.");
      await pollTurns(token);
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: session?.title ?? title ?? "Live session" }} />
      {!token ? (
        <CenteredMessage text="Sign in to join a live session." />
      ) : (
        <ScrollView
          ref={scrollRef}
          style={{ backgroundColor: colors.bg }}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}
        >
          <View style={styles.panel}>
            <Text style={styles.title}>{session?.title ?? (loading ? "Loading session…" : "Session")}</Text>
            <View style={styles.metaRow}>
              <Text style={[styles.tag, session?.status === "live" && styles.liveTag]}>
                {statusLabel(session?.status)}
              </Text>
              <Text style={styles.meta}>{participants.length} present</Text>
              <Text style={styles.meta}>· max {session?.max_participants ?? "—"}</Text>
            </View>
            {session ? (
              <Text style={styles.meta}>
                {session.status === "live"
                  ? "The room is live."
                  : session.status === "scheduled"
                    ? "This session has not gone live yet."
                    : "This session has ended. The transcript stays available."}
              </Text>
            ) : null}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          {loading && !session ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.meta}>Loading session…</Text>
            </View>
          ) : null}

          <View style={styles.panel}>
            <Text style={styles.section}>Join &amp; speak</Text>
            {session?.status === "live" && !joined ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Display name"
                  placeholderTextColor={colors.muted}
                  maxLength={MAX_NAME}
                  value={displayName}
                  onChangeText={setDisplayName}
                  accessibilityLabel="Display name"
                />
                <Pressable
                  onPress={() => void join()}
                  disabled={busy || !displayName.trim()}
                  style={[styles.button, busy || !displayName.trim() ? styles.buttonDisabled : null]}
                  accessibilityRole="button"
                  accessibilityLabel="Join session"
                >
                  <Text style={styles.buttonText}>{busy ? "Working…" : "Join"}</Text>
                </Pressable>
              </>
            ) : null}
            {session?.status === "live" && joined ? (
              <>
                <Text style={styles.meta}>
                  Joined{me ? ` as ${me.display_name}` : ""}. Presence stays alive automatically.
                </Text>
                <Pressable
                  onPress={() => void leave()}
                  disabled={busy}
                  style={[styles.button, styles.leave]}
                  accessibilityRole="button"
                  accessibilityLabel="Leave session"
                >
                  <Text style={[styles.buttonText, styles.leaveText]}>{busy ? "Working…" : "Leave"}</Text>
                </Pressable>
              </>
            ) : null}
          </View>

          <View style={styles.panel}>
            <Text style={styles.section}>Chat</Text>
            {!joined ? <Text style={styles.meta}>Join the session to post.</Text> : null}
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="Say something to everyone…"
              placeholderTextColor={colors.muted}
              maxLength={MAX_TEXT}
              multiline
              editable={joined && session?.status === "live" && !busy}
              value={chatText}
              onChangeText={setChatText}
              accessibilityLabel="Chat message"
            />
            <Pressable
              onPress={() => void submitTurn("chat", chatText)}
              disabled={busy || !joined || session?.status !== "live" || !chatText.trim()}
              style={[styles.button, busy || !joined || session?.status !== "live" || !chatText.trim() ? styles.buttonDisabled : null]}
              accessibilityRole="button"
              accessibilityLabel="Send chat"
            >
              <Text style={styles.buttonText}>Send chat</Text>
            </Pressable>
          </View>

          {canSpeak ? (
            <View style={styles.panel}>
              <Text style={styles.section}>Speech (host/guest)</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                placeholder="What should the host say?"
                placeholderTextColor={colors.muted}
                maxLength={MAX_TEXT}
                multiline
                editable={session?.status === "live" && !busy}
                value={speechText}
                onChangeText={setSpeechText}
                accessibilityLabel="Speech text"
              />
              <Pressable
                onPress={() => void submitTurn("speech", speechText)}
                disabled={busy || session?.status !== "live" || !speechText.trim()}
                style={[styles.button, busy || session?.status !== "live" || !speechText.trim() ? styles.buttonDisabled : null]}
                accessibilityRole="button"
                accessibilityLabel="Queue speech"
              >
                <Text style={styles.buttonText}>Queue speech</Text>
              </Pressable>
            </View>
          ) : joined && !me ? (
            <Text style={styles.meta}>Rejoin with a display name to use speech controls.</Text>
          ) : joined && me?.muted ? (
            <Text style={styles.meta}>You are muted; chat still works.</Text>
          ) : joined ? (
            <Text style={styles.meta}>Only the host and guests can post speech.</Text>
          ) : null}

          <View style={styles.panel}>
            <Text style={styles.section}>Transcript</Text>
            {turns.length === 0 ? (
              <Text style={styles.meta}>No turns yet. Be the first to chat.</Text>
            ) : (
              turns.map((turn) => (
                <View key={turn.seq} style={styles.turn}>
                  <View style={styles.turnHead}>
                    <Text style={styles.speaker}>{turn.participant.display_name}</Text>
                    <Text style={styles.kind}>{turn.participant.kind}</Text>
                    <Text style={styles.meta}>
                      · {turn.kind} #{turn.seq}
                    </Text>
                  </View>
                  <Text style={styles.turnText}>{turn.text}</Text>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </>
  );
}

function CenteredMessage({ text }: { text: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.empty}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12, gap: 10 },
  panel: { backgroundColor: colors.card, padding: 14, borderRadius: 10, gap: 8 },
  title: { color: colors.text, fontWeight: "600", fontSize: 18 },
  section: { color: colors.text, fontWeight: "700", fontSize: 15 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  tag: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  liveTag: { color: colors.accent },
  meta: { color: colors.muted, fontSize: 12 },
  error: { color: colors.danger },
  notice: { color: colors.accent },
  loading: { alignItems: "center", gap: 8, padding: 16 },
  input: {
    backgroundColor: colors.bg,
    borderColor: "#2c2c3a",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
  },
  multiline: { minHeight: 72, textAlignVertical: "top" },
  button: { backgroundColor: colors.accent, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#000", fontWeight: "700" },
  leave: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.danger },
  leaveText: { color: colors.danger },
  turn: { borderTopWidth: 1, borderTopColor: "#2c2c3a", paddingTop: 8 },
  turnHead: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  speaker: { color: colors.text, fontWeight: "700" },
  kind: { color: colors.accent, fontSize: 11, textTransform: "uppercase" },
  turnText: { color: colors.text, marginTop: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  empty: { color: colors.muted, textAlign: "center" },
});
