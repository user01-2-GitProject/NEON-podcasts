import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { absoluteUrl, type FeedEpisode } from "./api";
import { useDownloads } from "./downloads";

// v1 player: expo-audio with background playback enabled in app.json.
// Lock-screen controls / queue (react-native-track-player) land in 3c.
type PlayerState = {
  current: FeedEpisode | null;
  playing: boolean;
  play: (episode: FeedEpisode) => void;
  toggle: () => void;
};

const PlayerContext = createContext<PlayerState | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<FeedEpisode | null>(null);
  const { localUri } = useDownloads();

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).catch(() => {});
  }, []);

  // Prefer a downloaded copy (works offline); fall back to streaming the remote audio_url.
  const play = useCallback(
    (episode: FeedEpisode) => {
      const uri = localUri(episode.id) ?? (episode.audio_url ? absoluteUrl(episode.audio_url) : null);
      if (!uri) return;
      player.replace({ uri });
      player.play();
      setCurrent(episode);
    },
    [player, localUri],
  );

  const toggle = useCallback(() => {
    if (status.playing) player.pause();
    else player.play();
  }, [player, status.playing]);

  return (
    <PlayerContext.Provider value={{ current, playing: status.playing, play, toggle }}>{children}</PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}
