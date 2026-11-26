const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

test("example ids drive the Browse chip and leave every other show alone", async () => {
  const lib = await import("../lib/example-shows.ts");
  assert.equal(lib.EXAMPLE_SHOWS.length, 2);
  assert.deepEqual(lib.EXAMPLE_SHOWS.map((s) => s.title), [
    "Sterling Reads the News",
    "Rarely Made History",
  ]);
  for (const show of lib.EXAMPLE_SHOWS) {
    assert.equal(lib.isExampleShow(show.id), true);
    assert.equal(lib.exampleChipLabel(show.id), "Example");
    assert.match(show.rssToken, /^[0-9a-f]{32}$/);
  }
  for (const id of ["", "some-other-show", null, undefined]) {
    assert.equal(lib.isExampleShow(id), false);
    assert.equal(lib.exampleChipLabel(id), null);
  }
});

test("the wizard link follows the format: news brief by default, narrative essay for History", async () => {
  const lib = await import("../lib/example-shows.ts");
  assert.equal(lib.exampleForFormat("news").key, "sterling-news");
  assert.equal(lib.exampleForFormat("history").key, "rarely-made-history");
  assert.equal(lib.exampleForFormat(undefined).key, "sterling-news");
  assert.equal(
    lib.exampleListenPath(lib.exampleForFormat("history")),
    "/listen/5e9d0000000000000000000000000002",
  );

  const wizard = readFileSync("components/ShowWizard.tsx", "utf8");
  assert.match(wizard, /See a show like this/);
  assert.match(wizard, /exampleForFormat\(draft\.format\)/);
  const browse = readFileSync("app/browse/page.tsx", "utf8");
  assert.match(browse, /isExampleShow\(show\.id\)/);
  assert.match(browse, /tag example">Example/);
  assert.match(browse, /when \$\{EXAMPLE_SHOWS\[0\]\.id\} then 0/);
});

test("seed data is built from the wizard example templates, not copied prose", async () => {
  const { buildExampleSeed, AUDIO_FIXTURE } = await import("../scripts/seed-example-shows.ts");
  const { EXAMPLE_SHOWS } = await import("../lib/example-shows.ts");
  const bytes = readFileSync(AUDIO_FIXTURE);

  for (const definition of EXAMPLE_SHOWS) {
    const template = readFileSync(definition.templatePath, "utf8");
    const seed = buildExampleSeed(definition, template, bytes.length, `/api/episodes/${definition.episodeId}/audio`);
    assert.equal(seed.show.id, definition.id);
    assert.equal(seed.show.title, definition.title);
    assert.equal(seed.show.rssToken, definition.rssToken);
    assert.equal(seed.episode.id, definition.episodeId);
    assert.equal(seed.episode.byteSize, bytes.length);

    // The description and style guide are parsed straight from the .md file.
    const tagline = /^tagline: "(.+)"/m.exec(template)[1];
    assert.equal(seed.show.description, tagline);
    assert.match(seed.show.styleGuide, /## Hard rules/);
    assert.ok(seed.episode.showNotes.includes(tagline), `${definition.key} notes reuse the tagline`);
    assert.ok(seed.episode.showNotes.includes(`three-minute sample of the ${definition.formatLabel} format`));
    assert.equal(seed.episode.script, seed.episode.showNotes);
  }

  const [news, history] = EXAMPLE_SHOWS.map((d) =>
    buildExampleSeed(d, readFileSync(d.templatePath, "utf8"), bytes.length, "audio"),
  );
  assert.match(news.episode.showNotes, /news brief/);
  assert.match(history.episode.showNotes, /narrative essay/);
  assert.notEqual(news.show.description, history.show.description);
});

test("seedExamples is repeatable: same ids and one audio put per example per run", async () => {
  const { seedExamples } = await import("../scripts/seed-example-shows.ts");
  const { EXAMPLE_SHOWS } = await import("../lib/example-shows.ts");
  let calls = [];
  const db = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (/select id from users/.test(text)) return [{ id: "system-user-id" }];
    return [];
  };
  const puts = [];
  const storage = {
    put: async (...args) => { puts.push(args); },
    get: async () => null,
    delete: async () => {},
    url: (key) => `/api/episodes/${key}/audio`,
  };

  const first = await seedExamples({ db, storage, rootDir: process.cwd() });
  await seedExamples({ db, storage, rootDir: process.cwd() });

  assert.deepEqual(first.map((s) => s.show.id), EXAMPLE_SHOWS.map((s) => s.id));
  const showInserts = calls.filter((c) => /insert into shows/.test(c.text));
  const episodeInserts = calls.filter((c) => /insert into episodes/.test(c.text));
  assert.equal(showInserts.length, 4); // two examples, two runs
  assert.equal(episodeInserts.length, 4);
  assert.ok(showInserts.every((c) => /on conflict \(id\) do update/.test(c.text)));
  assert.ok(episodeInserts.every((c) => /on conflict \(id\) do update/.test(c.text)));
  assert.ok(showInserts.every((c) => /is_active = false/.test(c.text)), "no scheduler runs");
  assert.deepEqual(puts.map((p) => p[0]), [
    EXAMPLE_SHOWS[0].episodeId, EXAMPLE_SHOWS[1].episodeId,
    EXAMPLE_SHOWS[0].episodeId, EXAMPLE_SHOWS[1].episodeId,
  ]);
  assert.ok(puts.every((p) => p[2] === "audio/mpeg"));
});

test("the baked fixture is a valid ~3-minute MP3 with no ID3 tags", async () => {
  const { frameLength } = await import("../lib/mp3.ts");
  const { AUDIO_FIXTURE, DEMO_DURATION_SECONDS } = await import("../scripts/seed-example-shows.ts");
  const bytes = readFileSync(AUDIO_FIXTURE);

  // lib/mp3.ts is the app's own frame reader; if it can walk every frame,
  // the browser and RSS readers can too. The Xing/Info header lives in frame 1.
  let offset = 0;
  let frames = 0;
  while (offset < bytes.length) {
    const length = frameLength(bytes, offset);
    assert.ok(length > 0, `valid frame at byte ${offset}`);
    offset += length;
    frames += 1;
  }
  assert.equal(offset, bytes.length);
  // Frames are 576 samples at 16 kHz = 27.78 fps.
  const seconds = frames * 576 / 16000;
  assert.ok(Math.abs(seconds - DEMO_DURATION_SECONDS) < 1, `duration was ${seconds}s`);
  assert.equal(DEMO_DURATION_SECONDS, 180);
  assert.ok(bytes.length < 200_000, "fixture stays small enough to commit");
});

test("package.json exposes the repeatable seed command", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(pkg.scripts["seed:examples"], /seed-example-shows\.ts/);
});
