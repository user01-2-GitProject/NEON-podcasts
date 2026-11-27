const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

const source = ts.transpileModule(readFileSync("lib/request-timeout.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const timeout = {};
new Function("require", "exports", source)((name) => require(name), timeout);

test("request timeout aborts and reports a clear error", async () => {
  let signal;
  await assert.rejects(
    timeout.withRequestTimeout("TTS request", (s) => {
      signal = s;
      return new Promise(() => {});
    }, 10),
    /TTS request timed out after 10ms/,
  );
  assert.equal(signal.aborted, true);
});

test("request timeout returns successful work before the deadline", async () => {
  assert.equal(await timeout.withRequestTimeout("quick", async () => "ok", 100), "ok");
});

test("fetch timeout aborts an unfinished response body with the same clear error", async () => {
  const fetchImpl = async (_input, init) => new Response(new ReadableStream({
    pull() {
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    },
  }));
  const response = await timeout.fetchWithTimeout("https://example.test", {}, "provider fetch", fetchImpl, 10);
  await assert.rejects(response.text(), /provider fetch timed out after 10ms/);
});

test("the timeout is configurable and defaults to sixty seconds", () => {
  const previous = process.env.OUTBOUND_FETCH_TIMEOUT_MS;
  try {
    delete process.env.OUTBOUND_FETCH_TIMEOUT_MS;
    assert.equal(timeout.requestTimeoutMs(), 60_000);
    process.env.OUTBOUND_FETCH_TIMEOUT_MS = "2500";
    assert.equal(timeout.requestTimeoutMs(), 2500);
  } finally {
    if (previous === undefined) delete process.env.OUTBOUND_FETCH_TIMEOUT_MS;
    else process.env.OUTBOUND_FETCH_TIMEOUT_MS = previous;
  }
});
