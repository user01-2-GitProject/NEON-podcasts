const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const EPISODE_ID = "22222222-2222-4222-8222-222222222222";

// Load a TS/TSX module from source with its imports swapped for test doubles,
// the same way tests/show-image.test.cjs exercises the show PATCH route.
function compile(file, modules, jsx = false) {
  const source = readFileSync(file, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      ...(jsx ? { jsx: ts.JsxEmit.React } : {}),
    },
  }).outputText;
  const exports = {};
  // Classic JSX transpiles to React.createElement; Next injects React at build
  // time, so supply it here too.
  new Function("React", "require", "exports", compiled)(React, (name) => {
    if (!(name in modules)) throw new Error(`unexpected import ${name}`);
    return modules[name];
  }, exports);
  return exports;
}

function recordingSql(respond) {
  const calls = [];
  const fn = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    return respond(text, values);
  };
  fn.calls = calls;
  return fn;
}

function patchRoute(sql) {
  return compile("app/api/episodes/[id]/route.ts", {
    "next/server": require("next/server"),
    "@/lib/db": { sql },
    "@/lib/errors": require("../lib/errors.ts"),
    "@/lib/storage": { getStorage: () => ({ delete: async () => {} }) },
  }).PATCH;
}

function patch(sql, body, raw = false) {
  const req = new Request(`https://app.test/api/episodes/${EPISODE_ID}`, {
    method: "PATCH",
    ...(raw ? { body } : { body: JSON.stringify(body) }),
  });
  return patchRoute(sql)(req, { params: Promise.resolve({ id: EPISODE_ID }) });
}

async function errorOf(res) {
  return (await res.json()).error;
}

test("migration adds the defaulted column without changing existing episodes", () => {
  const migration = readFileSync("db/migrations/014_episodes_is_official.sql", "utf8");
  assert.match(
    migration,
    /alter table episodes add column if not exists is_official boolean not null default false/i
  );
});

test("PATCH flips is_official on its own and returns the saved episode", async () => {
  for (const value of [true, false]) {
    const sql = recordingSql(() => [{ id: EPISODE_ID, status: "draft", is_official: value }]);
    const res = await patch(sql, { is_official: value });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).episode.is_official, value);
    assert.equal(sql.calls.length, 1);
    const call = sql.calls[0];
    assert.match(call.text, /update episodes set/);
    assert.match(call.text, /is_official/);
    assert.ok(call.values.includes(value));
    assert.ok(call.values.includes(EPISODE_ID));
  }
});

test("PATCH accepts status and badge together without changing status alone", async () => {
  const sql = recordingSql(() => [{ id: EPISODE_ID, status: "published", is_official: true }]);
  const res = await patch(sql, { status: "published", is_official: true });
  assert.equal(res.status, 200);
  const call = sql.calls[0];
  assert.match(call.text, /published_at/);
  assert.match(call.text, /is_official/);
  assert.ok(call.values.includes("published"));
  assert.ok(call.values.includes(true));
  assert.ok(call.values.includes(EPISODE_ID));

  const statusOnly = recordingSql(() => [{ id: EPISODE_ID, status: "draft" }]);
  assert.equal((await patch(statusOnly, { status: "draft" })).status, 200);
  assert.doesNotMatch(statusOnly.calls[0].text, /is_official/);
  const publishOnly = recordingSql(() => [{ id: EPISODE_ID, status: "published" }]);
  assert.equal((await patch(publishOnly, { status: "published" })).status, 200);
  assert.match(publishOnly.calls[0].text, /published_at = coalesce\(published_at, now\(\)\)/);
  assert.doesNotMatch(publishOnly.calls[0].text, /is_official/);
});

test("PATCH refuses bad flags and bad statuses in plain words before writing", async () => {
  for (const bad of ["yes", "true", 1, 0, null, {}, []]) {
    const sql = recordingSql(() => []);
    const res = await patch(sql, { is_official: bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.match(await errorOf(res), /true or false/);
    assert.equal(sql.calls.length, 0);
  }

  const sql = recordingSql(() => []);
  const res = await patch(sql, { status: "live", is_official: true });
  assert.equal(res.status, 400);
  assert.match(await errorOf(res), /published or a draft/);
  assert.equal((await patch(sql, {})).status, 400);
  assert.equal((await patch(sql, "not json", true)).status, 400);
  assert.equal(sql.calls.length, 0);
});

test("PATCH reports a missing episode in plain words", async () => {
  const sql = recordingSql(() => []);
  const res = await patch(sql, { is_official: true });
  assert.equal(res.status, 404);
  assert.match(await errorOf(res), /couldn't find that episode/);
});

const badge = compile("components/OfficialBadge.tsx", {}, true).default;
const EpisodesPanel = compile("components/EpisodesPanel.tsx", {
  react: React,
  "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
  "next/navigation": { useRouter: () => ({ refresh() {} }) },
  "@/components/OfficialBadge": { default: badge },
  "./generation-client": { readJson: async () => ({}) },
}, true).default;

const episode = {
  id: EPISODE_ID,
  show_id: "11111111-1111-4111-8111-111111111111",
  title: "Markets today",
  script: "",
  show_notes: "",
  audio_url: null,
  duration_seconds: null,
  byte_size: null,
  status: "draft",
  scheduled_for: null,
  published_at: null,
  created_at: "2026-11-26T00:00:00Z",
};

function render(owner, official) {
  return renderToStaticMarkup(
    React.createElement(EpisodesPanel, {
      initialEpisodes: [
        { ...episode, is_official: official },
        { ...episode, id: "ep-2", title: "Plain episode", is_official: false },
      ],
      runs: [],
      owner,
      rssToken: "feed-token",
    })
  );
}

test("only official episodes show the badge, beside the title", () => {
  const html = render(false, true);
  const badges = html.match(/src="\/brand\/neon-logo-orbit-360-clean\.gif"/g) || [];
  assert.equal(badges.length, 1);
  assert.ok(html.indexOf("/brand/neon-logo-orbit-360-clean.gif") < html.indexOf("Markets today"));
  assert.ok(html.indexOf("/brand/neon-logo-orbit-360-clean.gif") < html.indexOf("Plain episode"));
  assert.doesNotMatch(html, /NEON-official/); // no owner toggle for members

  const unchanged = render(false, false);
  assert.doesNotMatch(unchanged, /neon-logo-orbit-360-clean\.gif/);
  assert.equal(unchanged.includes("Markets today"), true);
});

test("owners get episode-specific toggle wording, posted to the episode", () => {
  const html = render(true, true);
  assert.match(html, /Remove episode badge/);
  assert.match(html, /Mark episode official/);

  const source = readFileSync("components/EpisodesPanel.tsx", "utf8");
  assert.match(source, /`\/api\/episodes\/\$\{episodeId\}`/);
  assert.match(source, /JSON\.stringify\(\{ is_official: next \}\)/);
  assert.match(source, /owner \? <OfficialToggle/);
});
