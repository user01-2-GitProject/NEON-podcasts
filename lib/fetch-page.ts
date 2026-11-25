import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { extractDocumentText, htmlToText, capText, type Extracted } from "@/lib/documents";

// Fetch a public web page (or PDF) an owner pasted as source material.
// Guarded against reaching private networks: http(s) only, default ports,
// every hop's host must resolve to public addresses, redirects re-checked,
// small size and time limits.

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(v) === 6) {
    return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff");
  }
  return true;
}

type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

export async function checkPublicUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL | string> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "That doesn't look like a web address. It should start with https://";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Only web links (https://…) can be added.";
  if (url.username || url.password) return "Links with a username or password can't be added.";
  if (url.port && !["80", "443"].includes(url.port)) return "That link uses an unusual port and can't be added.";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolve(host);
  } catch {
    return "We couldn't find that website. Check the link.";
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) return "That link points somewhere we can't open.";
  return url;
}

export async function fetchPageText(raw: string, resolve: Resolver = defaultResolver): Promise<Extracted & { title?: string }> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = await checkPublicUrl(current, resolve);
    if (typeof checked === "string") return { error: checked };
    let res: Response;
    try {
      res = await fetch(checked, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "NEON-Podcasts/1.0 (+source material fetch)", Accept: "text/html,application/pdf,text/plain;q=0.9,*/*;q=0.5" },
      });
    } catch {
      return { error: "That page wouldn't open for us. Paste the text instead." };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, checked).href;
      continue;
    }
    if (!res.ok) return { error: "That page wouldn't open for us. Paste the text instead." };

    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) return { error: "That page is too big to read. Paste the part you need instead." };
    const reader = res.body?.getReader();
    if (!reader) return { error: "That page was empty." };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return { error: "That page is too big to read. Paste the part you need instead." };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }

    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (type.includes("pdf")) return extractDocumentText(bytes, "page.pdf", "application/pdf");
    const body = new TextDecoder("utf-8").decode(bytes);
    if (type.includes("html") || /<html[\s>]/i.test(body.slice(0, 2000))) {
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1];
      const text = htmlToText(body);
      if (!text) return { error: "We couldn't find any text on that page. Paste it instead." };
      return { ...capText(text), title: title ? htmlToText(title).slice(0, 120) : undefined };
    }
    if (type.startsWith("text/") || !type) return capText(body);
    return { error: "That link isn't a page or document we can read. Paste the text instead." };
  }
  return { error: "That link redirects too many times. Paste the text instead." };
}
