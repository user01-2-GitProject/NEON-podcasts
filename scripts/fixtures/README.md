# Example-show audio fixture

`example-silent-3min.mp3` is a deliberately boring, valid MP3: 180 seconds of
digital silence, used by both worked-example episodes so `/browse` shows a
published show with playable audio and a three-minute duration.

Made locally with ffmpeg (no network, no generated speech):

```sh
ffmpeg -f lavfi -i anullsrc=r=16000:cl=mono -t 180 \
  -c:a libmp3lame -b:a 8k -write_xing 1 -id3v2_version 0 \
  scripts/fixtures/example-silent-3min.mp3
```

The result is ~180 KB, MPEG audio, one mono channel at 16 kHz. It has an Info
(Xing) header so players report 3:00 before playback starts. `npm run
seed:examples` copies these bytes into episode storage through `lib/storage.ts`;
the file is never served directly, so re-running the seed is safe.

To check it: `ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 scripts/fixtures/example-silent-3min.mp3`.
