import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { absoluteUrl, type FeedEpisode } from "./api";
import { useDownloads } from "./downloads";

// v1 player: expo-audio with background playback AND lock-screen "Now Playing"
// controls — title + show on the lock screen / notification, with working
// play / pause / seek. expo-audio is a built-in Expo module, so these controls
// run in Expo Go with no dev client required.
type PlayerState = {
  current: FeedEpisode | null;
  playing: boolean;
  play: (episode: FeedEpisode) => void;
  toggle: () => void;
  /** Seek relative to the current position (negative = back). Also what the lock-screen skip buttons do. */
  seekBy: (seconds: number) => void;
};

const PlayerContext = createContext<PlayerState | null>(null);

// Metadata shown on the lock screen / Now Playing. Album carries the network
// name; artwork is the show's image when the server provides one.
function lockMetadata(episode: FeedEpisode) {
  return {
    title: episode.title,
    artist: episode.show_title,
    albumTitle: "NEON",
    ...(episode.show_image_url ? { artworkUrl: episode.show_image_url } : {}),
  };
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<FeedEpisode | null>(null);
  const { localUri } = useDownloads();
  const lockActive = useRef(false);

  useEffect(() => {
    // `interruptionMode: "doNotMix"` is required for the OS to attach the
    // lock-screen controls to this player (per expo-audio docs).
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    }).catch(() => {});
    return () => {
      try {
        player.setActiveForLockScreen(false);
      } catch {}
    };
  }, [player]);

  // Prefer a downloaded copy (works offline); fall back to streaming the remote audio_url.
  const play = useCallback(
    (episode: FeedEpisode) => {
      const uri = localUri(episode.id) ?? (episode.audio_url ? absoluteUrl(episode.audio_url) : null);
      if (!uri) return;
      player.replace({ uri });
      player.play();
      setCurrent(episode);
      // Register this player with the OS Now Playing / remote command center so
      // the lock screen shows the episode and its play/pause/seek buttons drive it.
      try {
        player.setActiveForLockScreen(true, lockMetadata(episode), {
          showSeekForward: true,
          showSeekBackward: true,
        });
        lockActive.current = true;
      } catch {}
    },
    [player, localUri],
  );

  // Keep the lock-screen text in sync when the current episode changes.
  useEffect(() => {
    if (current && lockActive.current) {
      try {
        player.updateLockScreenMetadata(lockMetadata(current));
      } catch {}
    }
  }, [current, player]);

  const toggle = useCallback(() => {
    if (status.playing) player.pause();
    else player.play();
  }, [player, status.playing]);

  const seekBy = useCallback(
    (seconds: number) => {
      const target = Math.max(0, (status.currentTime ?? 0) + seconds);
      player.seekTo(target).catch(() => {});
    },
    [player, status.currentTime],
  );

  return (
    <PlayerContext.Provider value={{ current, playing: status.playing, play, toggle, seekBy }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}
