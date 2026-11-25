// Checks an uploaded cover picture before it's stored. Owners only (the
// upload route sits behind the owner check in middleware). Reads the size
// straight from the PNG or JPEG header, so no image library is needed.

export const COVER_MAX_BYTES = 4 * 1024 * 1024; // Vercel caps a request at 4.5 MB.
export const COVER_MIN_PX = 1400;
export const COVER_MAX_PX = 3000;

export interface ImageInfo {
  contentType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  /** JPEG only: 4 colour channels means CMYK, which Apple refuses. */
  cmyk?: boolean;
}

export function imageInfo(buf: Buffer): ImageInfo | null {
  // PNG: 8-byte signature, then the IHDR chunk holds width and height.
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a && buf.toString("ascii", 12, 16) === "IHDR") {
    return { contentType: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: walk the segments until a start-of-frame marker.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return {
          contentType: "image/jpeg",
          height: buf.readUInt16BE(i + 5),
          width: buf.readUInt16BE(i + 7),
          cmyk: buf[i + 9] === 4,
        };
      }
      i += 2 + len;
    }
  }
  return null;
}

// The picture's type, or a plain sentence saying what's wrong with it.
export function checkCover(buf: Buffer): { contentType: ImageInfo["contentType"] } | { error: string } {
  if (!buf.length) return { error: "That file is empty. Pick your cover picture again." };
  if (buf.length > COVER_MAX_BYTES) {
    return { error: "That picture is over 4 MB. Save it as a JPG (or a smaller PNG) and try again." };
  }
  const info = imageInfo(buf);
  if (!info) return { error: "That isn't a JPG or PNG picture. Apple only takes those two." };
  if (info.width !== info.height) {
    return { error: `Apple needs a square picture. This one is ${info.width} × ${info.height}.` };
  }
  if (info.width < COVER_MIN_PX || info.width > COVER_MAX_PX) {
    return { error: `Apple needs a square between ${COVER_MIN_PX} and ${COVER_MAX_PX} pixels wide. This one is ${info.width}.` };
  }
  if (info.cmyk) return { error: "This JPG uses print (CMYK) colours. Save it in RGB and try again." };
  return { contentType: info.contentType };
}

// The link a show's image_url gets after an upload. The ?u= part changes on
// every upload so apps and feeds fetch the new picture.
export function uploadedCoverPath(showId: string, at: number = Date.now()): string {
  return `/art/${showId}?u=${at.toString(36)}`;
}

export function isUploadedCoverPath(showId: string, raw: string | null | undefined): boolean {
  return typeof raw === "string" && raw.startsWith(`/art/${showId}?u=`) && /^[0-9a-z]+$/.test(raw.slice(`/art/${showId}?u=`.length));
}
