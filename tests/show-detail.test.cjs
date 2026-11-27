const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const page = readFileSync("app/shows/[id]/page.tsx", "utf8");
const hero = readFileSync("components/ShowHero.tsx", "utf8");
const css = readFileSync("app/shows/[id]/show-detail.css", "utf8");
const episodes = readFileSync("components/EpisodesPanel.tsx", "utf8");

test("the show page delegates its product-page layout to ShowHero", () => {
  assert.match(page, /import ShowHero from "@\/components\/ShowHero"/);
  assert.match(page, /import "\.\/show-detail\.css"/);
  assert.match(page, /<ShowHero show=\{show\} owner=\{owner\} justSaved=\{justSaved\}>/);
  assert.match(page, /<EpisodesPanel[\s\S]*<\/ShowHero>/);
  // No second copy of the old hero panel left behind.
  assert.doesNotMatch(page, /<img className="show-art"/);
  assert.doesNotMatch(page, /<OfficialToggle showId=\{id\}/);
});

test("the hero puts artwork + owner actions in a sticky column beside the content", () => {
  assert.match(hero, /<section className="show-detail"/);
  assert.match(hero, /<div className="show-detail-aside">/);
  assert.match(hero, /<div className="show-detail-main">/);
  assert.match(hero, /\{children\}/);
  assert.match(hero, /owner \? \([\s\S]*Edit show[\s\S]*Edit schedule[\s\S]*OfficialToggle[\s\S]*ShowArtworkForm[\s\S]*DeleteShowButton/);
  assert.match(hero, /show\.is_official \? <OfficialBadge size=\{32\}/);
  assert.match(css, /\.show-detail \{[\s\S]*grid-template-columns: minmax\(260px, 360px\) minmax\(0, 1fr\)/);
  assert.match(css, /\.show-detail-aside \{[\s\S]*position: sticky/);
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
});

test("the hero uses the brand tokens: Didone title, gold hairline, slate primary", () => {
  assert.match(css, /\.show-detail-title \{[\s\S]*font-family: var\(--font-display/);
  assert.match(css, /border-bottom: 1px solid var\(--hairline\)/);
  assert.match(css, /\.show-detail \.btn\.primary \{[\s\S]*background: var\(--accent\)/);
  assert.match(css, /\.show-detail \.btn\.secondary \{[\s\S]*border: 1px solid var\(--hairline/);
  assert.match(css, /color: var\(--heading\)/);
});

test("episodes are part of the right-hand column", () => {
  assert.match(episodes, /className="panel episodes-panel"/);
  assert.match(css, /\.episodes-panel \{ margin-bottom: 18px; \}/);
});

test("friendlyTime formats a schedule slot for humans", async () => {
  const { friendlyTime } = await import("../components/ShowHero.tsx");
  assert.equal(friendlyTime("18:00"), "6:00 PM");
  assert.equal(friendlyTime("09:05"), "9:05 AM");
  assert.equal(friendlyTime("00:30"), "12:30 AM");
  assert.equal(friendlyTime("bogus"), "bogus");
});
