import Anthropic from "@anthropic-ai/sdk";
import { resolveLlmConfig } from "@/lib/settings";

export interface GeneratedScript {
  title: string;
  script: string; // full narration text (what TTS will read)
  show_notes: string; // markdown description for the episode
}

export const DEFAULT_MODEL = "claude-sonnet-5-5";
// Default model slug used when routing through OpenRouter. Override with
// OPENROUTER_MODEL (any slug from https://openrouter.ai/models, e.g. openai/gpt-4o).
export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-4.5";

interface GenerateArgs {
  showTitle: string;
  showDescription: string;
  targetMinutes: number;
  briefings: { filename: string; content_md: string }[];
  styleGuide?: string;
}

interface LlmResult {
  result: GeneratedScript;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

// Script generation. Routes to Anthropic (default) or OpenRouter based on
// LLM_PROVIDER. OpenRouter lets one key reach Claude *and* OpenAI (and others).
export async function generateScript(args: GenerateArgs): Promise<LlmResult> {
  const { system, userText } = buildPrompt(args);
  // In-app Settings (DB) override the env vars when present.
  const cfg = await resolveLlmConfig();

  if (cfg.provider === "openrouter") {
    return viaOpenRouter(system, userText, cfg.openRouterApiKey, cfg.openRouterModel);
  }
  return viaAnthropic(system, userText);
}

export function buildPrompt(args: GenerateArgs): { system: string; userText: string } {
  const briefingBlock = args.briefings.length
    ? args.briefings
        .map((b) => `--- BRIEFING: ${b.filename} ---\n${b.content_md}`)
        .join("\n\n")
    : "(No briefing documents were provided. Write a short general episode for the show.)";

  const systemLines = [
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
  ];
  const styleGuide = args.styleGuide?.trim();
  const system = styleGuide
    ? `${systemLines.join("\n")}\n\nSHOW STYLE GUIDANCE (follow this closely):\n${styleGuide}`
    : systemLines.join("\n");

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

  return { system, userText };
}

async function viaAnthropic(system: string, userText: string): Promise<LlmResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });

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

  return {
    result: parseScriptJson(text),
    model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}

async function viaOpenRouter(
  system: string,
  userText: string,
  apiKeyIn?: string | null,
  modelIn?: string | null,
): Promise<LlmResult> {
  const apiKey = apiKeyIn || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OpenRouter API key is not set — add it in Settings, or set OPENROUTER_API_KEY");
  }
  const model = modelIn || process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Optional attribution headers OpenRouter recommends:
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://neon-podcasts.vercel.app",
      "X-Title": "NEON Podcasts",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
    }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 500);
    } catch {
      detail = "<no body>";
    }
    throw new Error(`OpenRouter request failed (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter returned no content");

  return {
    result: parseScriptJson(text),
    model,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
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
    throw new Error("The model did not return a usable script");
  }
  return {
    title: (obj.title || "Untitled episode").toString(),
    script: obj.script,
    show_notes: (obj.show_notes || "").toString(),
  };
}

// Rough cost estimate in cents (Claude-sonnet-class pricing). Approximate for
// OpenRouter, where per-model pricing varies — treat runs.cost_cents as a guide.
export function estimateCostCents(inputTokens: number, outputTokens: number): number {
  const inputPerMTok = 300; // $3.00 / Mtok
  const outputPerMTok = 1500; // $15.00 / Mtok
  const cents = (inputTokens / 1_000_000) * inputPerMTok + (outputTokens / 1_000_000) * outputPerMTok;
  // runs.cost_cents is an INTEGER column, so this MUST be a whole number —
  // returning a fractional value (e.g. 1.07) makes the run INSERT fail with
  // "invalid input syntax for type integer", which 500s every generation.
  return Math.round(cents);
}
