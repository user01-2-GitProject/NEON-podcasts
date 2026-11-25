// Joining mp3 pieces from the voice service into one file.
//
// Each piece comes back as its own little mp3 file, and the first audio frame
// of each can be a "Xing"/"Info"/"VBRI" header that tells players how long the
// file is. Pasting the pieces end to end keeps those headers, so a player can
// believe the whole episode is only as long as the first piece (about 3-4
// minutes) and then skip or jump when it gets there. We drop ID3 tags and
// those length headers before joining, leaving plain audio frames.

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES_V1 = [44100, 48000, 32000];

// Length in bytes of the Layer III frame whose header starts at `i`, or 0 if
// there's no valid header there.
export function frameLength(buf: Uint8Array, i: number): number {
  if (i + 4 > buf.length) return 0;
  if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) return 0;
  const versionBits = (buf[i + 1] >> 3) & 0x03; // 0 = 2.5, 2 = 2, 3 = 1
  const layerBits = (buf[i + 1] >> 1) & 0x03; // 1 = Layer III
  if (versionBits === 1 || layerBits !== 1) return 0;
  const bitrateIdx = (buf[i + 2] >> 4) & 0x0f;
  const rateIdx = (buf[i + 2] >> 2) & 0x03;
  if (bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) return 0;
  const padding = (buf[i + 2] >> 1) & 0x01;
  const v1 = versionBits === 3;
  const bitrate = (v1 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIdx] * 1000;
  const rate = SAMPLE_RATES_V1[rateIdx] / (v1 ? 1 : versionBits === 2 ? 2 : 4);
  return Math.floor(((v1 ? 144 : 72) * bitrate) / rate) + padding;
}

function id3v2Size(buf: Uint8Array): number {
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return 0; // "ID3"
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  const footer = buf[5] & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

function hasAscii(buf: Uint8Array, start: number, end: number, word: string): boolean {
  outer: for (let i = start; i + word.length <= end; i++) {
    for (let j = 0; j < word.length; j++) if (buf[i + j] !== word.charCodeAt(j)) continue outer;
    return true;
  }
  return false;
}

// One piece with its tags and length header removed. Anything we can't
// recognize is passed through unchanged rather than risk cutting audio.
export function stripMp3Metadata(input: Uint8Array): Uint8Array {
  let start = Math.min(id3v2Size(input), input.length);
  let end = input.length;
  if (end - start >= 128 && input[end - 128] === 0x54 && input[end - 127] === 0x41 && input[end - 126] === 0x47) {
    end -= 128; // ID3v1 "TAG" at the very end
  }
  // Skip any junk before the first frame (a few bytes at most).
  let first = start;
  while (first < Math.min(end, start + 4096) && frameLength(input, first) === 0) first++;
  if (first >= end || frameLength(input, first) === 0) return input.subarray(start, end);
  start = first;
  const len = frameLength(input, start);
  if (start + len <= end && (hasAscii(input, start + 4, start + Math.min(len, 64), "Xing") ||
      hasAscii(input, start + 4, start + Math.min(len, 64), "Info") ||
      hasAscii(input, start + 4, start + Math.min(len, 64), "VBRI"))) {
    start += len;
  }
  return input.subarray(start, end);
}

export function joinMp3(pieces: Uint8Array[]): Buffer {
  if (pieces.length === 1) return Buffer.from(stripMp3Metadata(pieces[0]));
  return Buffer.concat(pieces.map((p) => stripMp3Metadata(p)));
}
