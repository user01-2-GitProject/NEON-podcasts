// Error sanitization for safe client responses.
// Logs full details server-side; returns generic messages to clients.

export function sanitizeError(err: unknown, context?: string): string {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  // Log full error server-side for debugging
  console.error(
    `[ERROR]${context ? ` ${context}` : ""}: ${message}`,
    stack ? `\n${stack}` : ""
  );

  // Return generic message to client — no internal details
  return "Something went wrong on our end. Try again in a minute.";
}

// For expected/validation errors that are safe to expose
export function safeErrorMessage(message: string): string {
  return message;
}

// Why "Make an episode" failed, in words the show owner can act on. Raw
// details still go to the server log through sanitizeError.
export function friendlyGenerateError(err: unknown): { message: string; status: number } {
  const raw = err instanceof Error ? err.message : String(err);
  if (/^Show not found/.test(raw)) return { message: "That show doesn't exist anymore.", status: 404 };
  if (/API key is not set|API_KEY is not set/i.test(raw)) {
    return {
      message: "The script writer isn't set up yet. An owner needs to add the AI key (OpenRouter) in Settings.",
      status: 503,
    };
  }
  if (/\((401|403)\)/.test(raw)) {
    return { message: "The AI key in Settings was turned down. Check it, then try again.", status: 502 };
  }
  if (/\(402\)/.test(raw)) {
    return { message: "The AI account is out of credit. Top it up, then try again.", status: 502 };
  }
  if (/\(429\)/.test(raw)) {
    return { message: "The AI service is busy right now. Try again in a minute.", status: 503 };
  }
  return {
    message: "We couldn't write this episode just now. Nothing was saved. Try again in a minute.",
    status: 500,
  };
}