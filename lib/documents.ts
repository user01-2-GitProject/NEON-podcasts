// Turn whatever a person has on their phone into plain text the host can
// read: PDF, Word (.docx), text-like files, or a web page's HTML.
// Errors are written for the person, not for us.

export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at ~4.5 MB.
export const MAX_SOURCE_CHARS = 60_000;

export type DocumentKind = "pdf" | "word" | "text" | "html" | "image" | "old-word" | "unknown";

export function documentKind(filename: string, mime: string): DocumentKind {
  const name = filename.toLowerCase();
  const type = (mime || "").toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type.includes("wordprocessingml") || name.endsWith(".docx")) return "word";
  if (type === "application/msword" || name.endsWith(".doc")) return "old-word";
  if (type.startsWith("image/") || /\.(png|jpe?g|heic|heif|gif|webp)$/.test(name)) return "image";
  if (type.includes("html") || /\.html?$/.test(name)) return "html";
  if (type.startsWith("text/") || /\.(txt|md|markdown|csv|rtf)$/.test(name)) return "text";
  return "unknown";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// Readable text from HTML: drops scripts, styles and page chrome, keeps
// paragraph breaks. Good enough for articles; not a full readability engine.
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function capText(text: string): { text: string; truncated: boolean } {
  const clean = text.replace(/\u0000/g, "").trim();
  if (clean.length <= MAX_SOURCE_CHARS) return { text: clean, truncated: false };
  return { text: clean.slice(0, MAX_SOURCE_CHARS), truncated: true };
}

export type Extracted = { text: string; truncated: boolean } | { error: string };

export async function extractDocumentText(bytes: Uint8Array, filename: string, mime: string): Promise<Extracted> {
  if (bytes.length === 0) return { error: "That file is empty." };
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    return { error: "That file is too big (over 4 MB). Try a smaller file, or paste the text instead." };
  }
  const kind = documentKind(filename, mime);
  let text = "";
  try {
    if (kind === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const out = await extractText(pdf, { mergePages: true });
      text = Array.isArray(out.text) ? out.text.join("\n\n") : out.text;
    } else if (kind === "word") {
      const mammoth = await import("mammoth");
      const out = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      text = out.value;
    } else if (kind === "text") {
      text = new TextDecoder("utf-8").decode(bytes);
    } else if (kind === "html") {
      text = htmlToText(new TextDecoder("utf-8").decode(bytes));
    } else if (kind === "old-word") {
      return { error: "That's an older Word file. Save it as .docx or PDF, or paste the text instead." };
    } else if (kind === "image") {
      return { error: "Photos can't be read yet. Paste the text, or upload a PDF or Word file." };
    } else {
      return { error: "We can't read that kind of file. Try a PDF, a Word file, or paste the text." };
    }
  } catch {
    return { error: "We couldn't read that file. Try a PDF, a Word file, or paste the text." };
  }
  if (!text.trim()) {
    return {
      error:
        kind === "pdf"
          ? "That PDF has no text we can read (it may be a scan). Paste the text instead."
          : "We couldn't find any text in that file.",
    };
  }
  return capText(text);
}
