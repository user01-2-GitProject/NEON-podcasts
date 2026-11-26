const { test } = require("node:test");
const assert = require("node:assert/strict");

test("answers become a show brief with plain headings", async () => {
  const { composeBody } = await import("../lib/show-wizard.ts");
  assert.equal(composeBody({ about: " Stocks and memes. ", audience: "", tone: "Casual" }),
    "## About the show\nStocks and memes.\n\n## Voice & style\nCasual");
  assert.equal(composeBody({ about: "", audience: "", tone: "" }), "");
});

test("tagline falls back to the first sentence, capped", async () => {
  const { taglineFrom } = await import("../lib/show-wizard.ts");
  assert.equal(taglineFrom("Daily market moves. Plus rumors."), "Daily market moves.");
  assert.equal(taglineFrom("no period here"), "no period here");
  assert.equal(taglineFrom(""), "");
  const long = taglineFrom("x".repeat(300));
  assert.equal(long.length, 140);
  assert.ok(long.endsWith("…"));
});

test("artwork: TBD or blank means none; bare domains get https", async () => {
  const { cleanImageUrl } = await import("../lib/show-wizard.ts");
  assert.equal(cleanImageUrl("TBD"), "");
  assert.equal(cleanImageUrl("  "), "");
  assert.equal(cleanImageUrl("none"), "");
  assert.equal(cleanImageUrl("https://x.test/a.png"), "https://x.test/a.png");
  assert.equal(cleanImageUrl("i.imgur.com/abc.png"), "https://i.imgur.com/abc.png");
  assert.equal(cleanImageUrl("javascript:alert(1)"), "");
});

test("a guided show passes the same validation as show.md", async () => {
  const { composeBody, taglineFrom } = await import("../lib/show-wizard.ts");
  const { emptyShowSpec, validateShowSpec, buildStyleGuide } = await import("../lib/show-spec.ts");
  const about = "Stock updates and meme rumors.";
  const spec = { ...emptyShowSpec(), title: "Diamond Hands", cadence: "daily", timezone: "America/Detroit", tagline: taglineFrom(about), body: composeBody({ about, audience: "Retail investors", tone: "Hype" }) };
  assert.deepEqual(validateShowSpec(spec), []);
  assert.match(buildStyleGuide(spec), /Retail investors/);
});

test("the wizard's example shows are valid show files", async () => {
  const { readFileSync, readdirSync } = require("node:fs");
  const { parseShowMd, validateShowSpec } = await import("../lib/show-spec.ts");
  const files = readdirSync("templates/examples").filter((f) => f.endsWith(".md"));
  assert.ok(files.length >= 1);
  for (const f of files) {
    const { spec, errors } = parseShowMd(readFileSync(`templates/examples/${f}`, "utf8"));
    assert.deepEqual([...errors, ...validateShowSpec(spec)], [], f);
    assert.ok(spec.body.includes("## Hard rules"), `${f} shows an example of hard rules`);
  }
});

test("the wizard's 'most important' and 'look up' answers become sections the app reads", async () => {
  const { composeBody } = await import("../lib/show-wizard.ts");
  const { researchBrief, researchSites } = await import("../lib/research.ts");
  const body = composeBody({ about: "Football.", audience: "", tone: "", important: "Be fair.", lookup: "This week's game.\nSites: espn.com" });
  assert.match(body, /## What matters most\nBe fair\./);
  assert.equal(researchBrief(body), "This week's game.\nSites: espn.com");
  assert.deepEqual(researchSites(researchBrief(body)), ["espn.com"]);
  assert.equal(composeBody({ about: "x", audience: "", tone: "", important: " ", lookup: "" }), "## About the show\nx");
});

test("editing: a saved brief splits back into filled-in answers", async () => {
  const { composeBody, splitBrief, joinBrief } = await import("../lib/show-wizard.ts");
  const a = { about: "Stocks and memes.", audience: "Casual investors", tone: "Casual", important: "Never take sides", lookup: "Top movers\nSites: cnbc.com" };
  const body = composeBody(a);
  const { answers, layout } = splitBrief(body);
  assert.deepEqual(answers, a);
  assert.equal(joinBrief(layout, answers), body);
});

test("editing: sections the questions don't cover are kept in place", async () => {
  const { splitBrief, joinBrief } = await import("../lib/show-wizard.ts");
  const body = "## Format\nNews\n\n## About the show\n- Topic: USA news\n- Unbiased\n\n## Hosts\n- Sterling\n\n## Hard rules\nNo swearing";
  const { answers, layout } = splitBrief(body);
  assert.equal(answers.about, "- Topic: USA news\n- Unbiased");
  assert.equal(answers.tone, "");
  assert.equal(joinBrief(layout, answers), body);
  const edited = joinBrief(layout, { ...answers, about: "USA news, straight.", tone: "Calm" });
  assert.equal(edited, "## Format\nNews\n\n## About the show\nUSA news, straight.\n\n## Hosts\n- Sterling\n\n## Hard rules\nNo swearing\n\n## Voice & style\nCalm");
});

test("editing: text before any heading is reported so the form keeps the full brief", async () => {
  const { splitBrief } = await import("../lib/show-wizard.ts");
  assert.equal(splitBrief("Just some notes\n\n## About the show\nX").layout.preamble, "Just some notes");
  assert.equal(splitBrief("").layout.preamble, "");
});
