import { Directory, File, Paths } from "expo-file-system";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { absoluteUrl, type FeedEpisode } from "./api";

// Offline downloads: mp3s live in <documents>/downloads/<episodeId>.mp3, with a small JSON
// index alongside so the Downloads tab survives restarts. audio_url already carries ?feed=<token>,
// so no auth header is needed to fetch it.
export type DownloadedEpisode = { episode: FeedEpisode; uri: string; downloaded_at: string };

export type DownloadStatus =
  | { state: "none" }
  | { state: "downloading"; progress: number | null }
  | { state: "downloaded" };

type DownloadsState = {
  downloads: DownloadedEpisode[];
  status: (episodeId: string) => DownloadStatus;
  localUri: (episodeId: string) => string | null;
  download: (episode: FeedEpisode) => Promise<void>;
  remove: (episodeId: string) => void;
};

const dir = new Directory(Paths.document, "downloads");
const indexFile = new File(dir, "index.json");
const fileFor = (episodeId: string) => new File(dir, `${episodeId.replace(/[^A-Za-z0-9_-]/g, "_")}.mp3`);

function readIndex(): Record<string, DownloadedEpisode> {
  if (!indexFile.exists) return {};
  try {
    const parsed = JSON.parse(indexFile.textSync()) as Record<string, DownloadedEpisode>;
    // Drop entries whose file vanished (e.g. cleared by the OS or a reinstall).
    return Object.fromEntries(Object.entries(parsed).filter(([id]) => fileFor(id).exists));
  } catch {
    return {};
  }
}

function writeIndex(index: Record<string, DownloadedEpisode>) {
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  indexFile.writeSync(JSON.stringify(index));
}

const DownloadsContext = createContext<DownloadsState | null>(null);

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState<Record<string, DownloadedEpisode>>({});
  const [progress, setProgress] = useState<Record<string, number | null>>({});
  const indexRef = useRef(index);

  const commit = useCallback((next: Record<string, DownloadedEpisode>) => {
    indexRef.current = next;
    setIndex(next);
    writeIndex(next);
  }, []);

  useEffect(() => {
    const loaded = readIndex();
    indexRef.current = loaded;
    setIndex(loaded);
  }, []);

  const download = useCallback(
    async (episode: FeedEpisode) => {
      if (!episode.audio_url || indexRef.current[episode.id]) return;
      setProgress((p) => (episode.id in p ? p : { ...p, [episode.id]: null }));
      try {
        if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
        const file = await File.downloadFileAsync(absoluteUrl(episode.audio_url), fileFor(episode.id), {
          idempotent: true,
          onProgress: ({ bytesWritten, totalBytes }) =>
            setProgress((p) => ({ ...p, [episode.id]: totalBytes > 0 ? bytesWritten / totalBytes : null })),
        });
        commit({
          ...indexRef.current,
          [episode.id]: { episode, uri: file.uri, downloaded_at: new Date().toISOString() },
        });
      } catch {
        const partial = fileFor(episode.id);
        if (partial.exists) partial.delete();
      } finally {
        setProgress(({ [episode.id]: _, ...rest }) => rest);
      }
    },
    [commit],
  );

  const remove = useCallback(
    (episodeId: string) => {
      const file = fileFor(episodeId);
      if (file.exists) file.delete();
      const { [episodeId]: _, ...rest } = indexRef.current;
      commit(rest);
    },
    [commit],
  );

  const status = useCallback(
    (episodeId: string): DownloadStatus => {
      if (index[episodeId]) return { state: "downloaded" };
      if (episodeId in progress) return { state: "downloading", progress: progress[episodeId] };
      return { state: "none" };
    },
    [index, progress],
  );

  const localUri = useCallback((episodeId: string) => {
    const entry = indexRef.current[episodeId];
    return entry && fileFor(episodeId).exists ? entry.uri : null;
  }, []);

  const downloads = Object.values(index).sort((a, b) => b.downloaded_at.localeCompare(a.downloaded_at));

  return (
    <DownloadsContext.Provider value={{ downloads, status, localUri, download, remove }}>
      {children}
    </DownloadsContext.Provider>
  );
}

export function useDownloads(): DownloadsState {
  const ctx = useContext(DownloadsContext);
  if (!ctx) throw new Error("useDownloads must be used inside DownloadsProvider");
  return ctx;
}
