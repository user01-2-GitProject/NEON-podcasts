export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export function requestTimeoutMs(): number {
  const configured = Number(process.env.OUTBOUND_FETCH_TIMEOUT_MS);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_REQUEST_TIMEOUT_MS;
}

export async function withRequestTimeout<T>(
  label: string,
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs = requestTimeoutMs(),
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([request(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  label: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = requestTimeoutMs(),
): Promise<Response> {
  const controller = new AbortController();
  let responseController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let timeoutError: Error | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectTimeout: (error: Error) => void = () => {};
  const timeout = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  timer = setTimeout(() => {
    timeoutError = new Error(`${label} timed out after ${timeoutMs}ms`);
    controller.abort(timeoutError);
    responseController?.error(timeoutError);
    rejectTimeout(timeoutError);
  }, timeoutMs);

  try {
    const response = await Promise.race([
      fetchImpl(input, { ...init, signal: controller.signal }),
      timeout,
    ]);
    if (!response.body) {
      if (timer) clearTimeout(timer);
      return response;
    }

    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      start(streamController) { responseController = streamController; },
      async pull(streamController) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            if (timer) clearTimeout(timer);
            streamController.close();
          } else {
            streamController.enqueue(chunk.value);
          }
        } catch (err) {
          if (timer) clearTimeout(timer);
          try { streamController.error(timeoutError ?? err); } catch {}
        }
      },
      async cancel(reason) {
        if (timer) clearTimeout(timer);
        controller.abort(reason);
        await reader.cancel(reason);
      },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (err) {
    if (timer) clearTimeout(timer);
    throw timeoutError ?? err;
  }
}
