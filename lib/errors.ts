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
  return "An error occurred. Please try again later.";
}

// For expected/validation errors that are safe to expose
export function safeErrorMessage(message: string): string {
  return message;
}