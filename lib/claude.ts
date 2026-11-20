import Anthropic from "@anthropic-ai/sdk";

export interface GeneratedScript {
  title: string;
  script: string; // full narration text (what TTS will read)
  show_notes: string; // markdown description for the episode
}

export const DEFAULT_MODEL = "claude-sonnet-5-5";

interface GenerateArgs {
  showTitle: string;
  showDescription: string;
  targetMinutes: number;
  briefings: { filename: string; content_md: string }[];
}

export async function generateScript(args: GenerateArgs): Promise<{
  result: GeneratedScript;
  model: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });

  const briefingBlock = args.briefings.length
    ? args.briefings
        .map((b) => `--- BRIEFING: ${b.filename} ---\n${b.content_md}`)
        .join("\n\n")
    : "(No briefing documents were provided. Write a short general episode for the show.)";

  const system = [
    "You are a podcast scriptwriter and producer.",
    "You write a single-host, natural-sounding spoken-word script that will be read aloud by a text-to-speech engine.",
    "Rules for the script field:",
    "- Plain spoken prose only. No stage directions, no markdown, no bullet points, no headings, no speaker labels.",
    "- Write it the way it should be spoken: full sentences, smooth transitions between segments.",
    "- Open with a brief intro that names the show, cover the briefing material as the body, and close with a short outro.",
    `- Aim for roughly ${args.targetMinutes} minute(s) of speech (about ${Math.round(
      args.targetMinutes * 150,
    )} words).`,
    "Rules for show_notes: concise markdown summary with a one-line hook and 3-6 bullet takeaways.",
    "Rules for title: a specific, engaging episode title (no date unless relevant).",
  ].join("\n");

  const userText = [
    `SHOW TITLE: ${args.showTitle}`,
    `SHOW DESCRIPTION: ${args.showDescription || "(none)"}`,
    `TARGET LENGTH: ~${args.targetMinutes} minute(s)`,
    "",
    "Source material (the briefing is the content for this episode):",
    briefingBlock,
    "",
    "Return ONLY a JSON object with exactly these string keys: title, script, show_notes.",
    "Do not wrap it in markdown fences. Do not add any other keys or commentary.",
  ].join("\n");

  const message = await client.messages.create({
    model,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: userText }],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const result = parseScriptJson(text);
  return {
    result,
    model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}

function parseScriptJson(text: string): GeneratedScript {
  let raw = text.trim();
  // Tolerate accidental code fences.
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  // Fall back to the first {...} block.
  if (!raw.startsWith("{")) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1) raw = raw.slice(start, end + 1);
  }
  const obj = JSON.parse(raw) as Partial<GeneratedScript>;
  if (!obj.script || typeof obj.script !== "string") {
    throw new Error("Claude did not return a usable script");
  }
  return {
    title: (obj.title || "Untitled episode").toString(),
    script: obj.script,
    show_notes: (obj.show_notes || "").toString(),
  };
}

// Rough Anthropic cost estimate (claude-sonnet pricing, in cents).
export function estimateCostCents(inputTokens: number, outputTokens: number): number {
  const inputPerMTok = 300; // $3.00 / Mtok
  const outputPerMTok = 1500; // $15.00 / Mtok
  const cents = (inputTokens / 1_000_000) * inputPerMTok + (outputTokens / 1_000_000) * outputPerMTok;
  return Math.round(cents * 100) / 100;
}
