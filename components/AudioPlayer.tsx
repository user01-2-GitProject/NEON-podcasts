"use client";

import { useRef, useState, type KeyboardEvent } from "react";

type AudioPlayerProps = {
  src: string;
  title?: string;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${remainingSeconds}`
    : `${minutes}:${remainingSeconds}`;
}

export default function AudioPlayer({ src, title }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }

  function seekTo(time: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(duration)) return;
    audio.currentTime = Math.max(0, Math.min(time, duration));
    setCurrentTime(audio.currentTime);
  }

  function skip(seconds: number) {
    seekTo((audioRef.current?.currentTime || 0) + seconds);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      skip(-5);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      skip(5);
    }
  }

  function changePlaybackRate(value: string) {
    const rate = Number(value);
    setPlaybackRate(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }

  return (
    <div
      className="audio-player"
      tabIndex={0}
      role="group"
      onKeyDown={handleKeyDown}
      aria-label={title ? `Audio player: ${title}` : "Audio player"}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          setDuration(Number.isFinite(value) ? value : 0);
        }}
        onDurationChange={(event) => {
          const value = event.currentTarget.duration;
          setDuration(Number.isFinite(value) ? value : 0);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />
      {title ? <p className="audio-player-title">{title}</p> : null}
      <input
        className="audio-player-seek"
        type="range"
        min={0}
        max={duration}
        step={0.1}
        value={Math.min(currentTime, duration)}
        onChange={(event) => seekTo(Number(event.currentTarget.value))}
        aria-label="Seek audio"
        disabled={!duration}
      />
      <div className="audio-player-controls">
        <div className="audio-player-buttons">
          <button
            className="btn secondary"
            type="button"
            onClick={() => skip(-15)}
            aria-label="Back 15 seconds"
          >
            −15s
          </button>
          <button
            className="btn"
            type="button"
            onClick={togglePlayback}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            className="btn secondary"
            type="button"
            onClick={() => skip(15)}
            aria-label="Forward 15 seconds"
          >
            +15s
          </button>
          <span className="audio-player-time" aria-live="off">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
        <label className="audio-player-speed">
          Speed
          <select
            value={playbackRate}
            onChange={(event) => changePlaybackRate(event.currentTarget.value)}
            aria-label="Playback speed"
          >
            <option value={1}>1x</option>
            <option value={1.25}>1.25x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2x</option>
          </select>
        </label>
      </div>
    </div>
  );
}
