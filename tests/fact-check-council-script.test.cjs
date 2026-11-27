const { test } = require("node:test");
const assert = require("node:assert/strict");

const council = require("../scripts/fact-check-council.mjs");

const TOKEN = `npt_${"a".repeat(64)}`;
const BASE_ENV = {
  NEON_BASE_URL: "https://neon.example/",
  NEON_TOKEN: TOKEN,
  MUSE_INPUT_DIR: "/tmp/muse-in",
  MUSE_OUTPUT_DIR: "/tmp/muse-out",
};

test("readConfig validates required settings and applies defaults", () => {
  const config = council.readConfig(BASE_ENV, []);
  assert.equal(config.baseUrl, "https://neon.example");
  assert.equal(config.codexCmd, "codex");
  assert.equal(config.leadCmd, "claude");
  assert.equal(config.pollMs, 120000);
  assert.equal(config.museTimeoutMs, 1800000);
  assert.equal(config.once, false);

  assert.equal(council.readConfig(BASE_ENV, ["--once"]).once, true);
  assert.equal(council.readConfig({ ...BASE_ENV, ONCE: "1" }, []).once, true);
  assert.equal(council.readConfig({ ...BASE_ENV, POLL_INTERVAL_MS: "5000" }, []).pollMs, 5000);
  assert.throws(() => council.readConfig({ ...BASE_ENV, NEON_TOKEN: "bad" }, []), /NEON_TOKEN/);
  assert.throws(() => council.readConfig({ ...BASE_ENV, MUSE_OUTPUT_DIR: "" }, []), /MUSE_OUTPUT_DIR/);
  assert.throws(() => council.readConfig({ ...BASE_ENV, POLL_INTERVAL_MS: "10" }, []), /POLL_INTERVAL_MS/);
});

test("readConfig accepts an optional local Qwen voter", () => {
  const config = council.readConfig({ ...BASE_ENV, QWEN_URL: "http://127.0.0.1:11434/", QWEN_MODEL: "qwen-test" }, []);
  assert.equal(config.qwenUrl, "http://127.0.0.1:11434");
  assert.equal(config.qwenModel, "qwen-test");
  assert.equal(config.qwenTimeoutMs, 60000);
  assert.throws(() => council.readConfig({ ...BASE_ENV, QWEN_URL: "nope" }, []), /QWEN_URL/);
});

test("runQwen calls Ollama and parses its JSON answer", async () => {
  let body;
  const deps = {
    fetch: async (url, init) => {
      assert.equal(url, "http://127.0.0.1:11434/api/chat");
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ notes: [{ kind: "wrong", message: "Qwen flag" }] }) } }) };
    },
  };
  const config = council.readConfig({ ...BASE_ENV, QWEN_URL: "http://127.0.0.1:11434" }, []);
  const item = { prompts: { qwen: { system: "QS", user: "QU" } } };
  const result = await council.runQwen(item, config, deps);
  assert.equal(result.persona, "qwen");
  assert.equal(result.model, "qwen3.5-9b-fc");
  assert.equal(result.notes[0].message, "Qwen flag");
  assert.equal(body.model, "qwen3.5-9b-fc");
  assert.equal(body.messages[0].content, "QS");
  await assert.rejects(() => council.runQwen({ prompts: {} }, config, deps), /missing the qwen prompt/);
  assert.equal(await council.runQwen(item, council.readConfig(BASE_ENV, []), deps), null);
});

test("parseMemberResult handles prose, fences, bad kinds and dedupe", () => {
  const text = [
    "Here is my report:",
    "```json",
    JSON.stringify({
      notes: [
        { kind: "wrong", message: "Wrong date", excerpt: "on Tuesday" },
        { kind: "wrong", message: "Wrong date again", excerpt: "on Tuesday" },
        { kind: "bogus", message: "Ignored" },
        { kind: "unsupported", message: "" },
      ],
      added_sources: ["https://example.com/a", "  "],
    }),
    "```",
  ].join("\n");
  const result = council.parseMemberResult(text);
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].kind, "wrong");
  assert.equal(result.notes[0].excerpt, "on Tuesday");
  assert.deepEqual(result.added_sources, ["https://example.com/a"]);
  assert.deepEqual(council.parseMemberResult("not json").notes, []);
});

test("parseLeadResult and parseRebuttal normalize the Lead and flagger answers", () => {
  const parsed = council.parseLeadResult(
    JSON.stringify({
      upheld: [{ persona: "scholar", kind: "outdated", message: "Old figure", excerpt: "12%" }],
      dismissed: [{ flag: { persona: "quickdraw", kind: "unsupported", message: "Maybe" }, reason: "Source implies it" }],
      tags: [" FINANCE ", "finance"],
      accepted_sources: ["https://example.com/ok"],
    }),
    ["quickdraw", "scholar"],
  );
  assert.equal(parsed.upheld[0].persona, "scholar");
  assert.equal(parsed.dismissed[0].flagger_agrees, false);
  assert.deepEqual(parsed.tags, ["finance"]);
  assert.deepEqual(parsed.accepted_sources, ["https://example.com/ok"]);
  assert.equal(council.parseRebuttal('{"agrees":true}'), true);
  assert.equal(council.parseRebuttal("yes, I accept that"), true);
  assert.equal(council.parseRebuttal('{"agrees":false}'), false);
});

test("councilVerdict parity: any real flag fails, accepted dismissal passes", () => {
  const flag = { persona: "quickdraw", kind: "wrong", message: "x" };
  const cases = [
    { input: { upheld: [], dismissed: [] }, expected: "pass" },
    { input: { upheld: [], dismissed: [{ flag, reason: "r", flagger_agrees: true }] }, expected: "pass" },
    { input: { upheld: [], dismissed: [{ flag, reason: "r", flagger_agrees: false }] }, expected: "fail" },
    { input: { upheld: [flag], dismissed: [] }, expected: "fail" },
    { input: { upheld: [flag], dismissed: [{ flag, reason: "r", flagger_agrees: true }] }, expected: "fail" },
  ];
  for (const { input, expected } of cases) {
    assert.equal(council.councilVerdict(input), expected);
  }
});

test("buildSubmission records the verdict, rebuttals and accepted sources", () => {
  const members = [
    { persona: "quickdraw", model: "codex", notes: [{ kind: "wrong", message: "Wrong" }], added_sources: ["https://a.test"] },
    { persona: "scholar", model: "muse", notes: [], added_sources: ["https://b.test"] },
  ];
  const lead = council.parseLeadResult(
    JSON.stringify({
      upheld: [],
      dismissed: [{ flag: { persona: "quickdraw", kind: "wrong", message: "Wrong" }, reason: "Actually right" }],
      tags: ["finance"],
      accepted_sources: ["https://a.test"],
    }),
    ["quickdraw", "scholar"],
  );
  const submission = council.buildSubmission({ episode_id: "ep1" }, members, lead, [true]);
  assert.equal(submission.verdict, "pass");
  assert.equal(submission.dismissed[0].flagger_agrees, true);
  assert.deepEqual(submission.added_sources, [
    { url: "https://a.test", by: "quickdraw", accepted: true },
    { url: "https://b.test", by: "scholar", accepted: false },
  ]);
  assert.equal(submission.members.length, 2);
});

test("memberPrompt, leadPrompt and command argument builders are exact", () => {
  const item = {
    episode_id: "ep1",
    title: "Test",
    prompts: {
      quickdraw: { system: "SYS", user: "USR" },
      scholar: { system: "SCHOLAR", user: "USR2" },
    },
  };
  assert.equal(council.memberPrompt(item, "quickdraw"), "SYS\n\nUSR");
  assert.match(council.leadPrompt(item, [{ persona: "quickdraw", model: "codex", notes: [] }]), /ep1/);
  assert.deepEqual(council.codexArgs("schema.json", "out.json", "prompt"), [
    "exec", "--skip-git-repo-check", "--output-schema", "schema.json", "-o", "out.json", "prompt",
  ]);
  assert.deepEqual(council.leadArgs("prompt"), ["-p", "--output-format", "json", "prompt"]);
  assert.throws(() => council.memberPrompt({ prompts: {} }, "scholar"), /missing the scholar prompt/);
});

test("processItem fans out, runs Lead + rebuttal, and POSTs a submission", async () => {
  const item = {
    episode_id: "ep1",
    title: "Council test",
    prompts: {
      quickdraw: { system: "Q", user: "script" },
      scholar: { system: "S", user: "script" },
    },
  };
  const config = council.readConfig(BASE_ENV, []);
  const files = new Map();
  const execFile = async (cmd, args) => {
    if (cmd === "codex") {
      const out = args[args.indexOf("-o") + 1];
      const prompt = args[args.length - 1];
      if (prompt.includes("You flagged this")) {
        files.set(out, JSON.stringify({ agrees: true }));
      } else {
        files.set(out, JSON.stringify({ notes: [{ kind: "wrong", message: "Wrong date" }] }));
      }
      return { stdout: "" };
    }
    if (cmd === "claude") {
      return {
        stdout: JSON.stringify({
          upheld: [],
          dismissed: [{ flag: { persona: "quickdraw", kind: "wrong", message: "Wrong date" }, reason: "Source agrees" }],
          tags: ["finance"],
        }),
      };
    }
    throw new Error(`unexpected command ${cmd}`);
  };
  const deps = {
    tmpDir: "/tmp/fc-test",
    execFile,
    sleep: async () => {},
    log: () => {},
    mkdir: async () => {},
    writeFile: async (path, data) => { files.set(path, data); },
    readFile: async (path) => {
      if (path.includes("fact-check-ep1.json")) {
        return JSON.stringify({ notes: [{ kind: "outdated", message: "Old figure" }] });
      }
      return files.has(path) ? files.get(path) : null;
    },
    unlink: async (path) => { files.delete(path); },
  };
  let posted;
  const client = { submit: async (id, body) => { posted = { id, body }; return { ok: true, fact_check: { verdict: "pass" } }; } };

  const { submission, result } = await council.processItem(item, config, deps, client);
  assert.equal(posted.id, "ep1");
  assert.equal(submission.verdict, "pass");
  assert.equal(submission.dismissed[0].flagger_agrees, true);
  assert.equal(submission.members.length, 2);
  assert.equal(result.fact_check.verdict, "pass");
});
