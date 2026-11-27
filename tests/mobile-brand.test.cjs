const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const layout = readFileSync("mobile/app/_layout.tsx", "utf8");
const tabs = readFileSync("mobile/app/(tabs)/_layout.tsx", "utf8");
const show = readFileSync("mobile/app/show/[token].tsx", "utf8");
const player = readFileSync("mobile/components/Player.tsx", "utf8");
const context = readFileSync("mobile/lib/theme-context.tsx", "utf8");
const settings = readFileSync("mobile/app/(tabs)/settings.tsx", "utf8");
const fonts = readFileSync("mobile/lib/fonts.ts", "utf8");

test("the two themes come from the brand sheet and follow the system by default", async () => {
  const { themes, themeFor, normalizePreference, THEME_STORAGE_KEY } = await import("../mobile/lib/theme.ts");
  assert.equal(THEME_STORAGE_KEY, "neon_theme");
  assert.equal(themes.light.bg, "#F9F2E2");
  assert.equal(themes.light.heading, "#183341");
  assert.equal(themes.light.accent, "#3D5A7E");
  assert.equal(themes.dark.bg, "#183341");
  assert.equal(themes.dark.text, "#F9F2E2");
  assert.equal(themes.dark.accent, "#D9C79A");
  for (const t of ["light", "dark"]) assert.equal(themes[t].hairline, "#A8895E");
  assert.equal(themeFor("system", "light"), "light");
  assert.equal(themeFor("system", "dark"), "dark");
  assert.equal(themeFor("system", null), "dark");
  assert.equal(themeFor("dark", "light"), "dark");
  assert.equal(normalizePreference("bogus"), "system");
});

test("the provider persists a saved choice and tracks system changes", () => {
  assert.match(context, /useColorScheme\(\)/);
  assert.match(context, /SecureStore\.getItemAsync\(THEME_STORAGE_KEY\)/);
  assert.match(context, /SecureStore\.setItemAsync\(THEME_STORAGE_KEY, next\)/);
  assert.match(layout, /<ThemeProvider>/);
  assert.match(layout, /StatusBar style=\{theme === "dark" \? "light" : "dark"\}/);
  assert.match(settings, /\{ value: "system", label: "System" \}/);
  assert.match(settings, /setPreference\(choice\.value\)/);
});

test("tab chrome and shared components use theme colors with gold hairlines", () => {
  assert.match(tabs, /const \{ colors: c \} = useTheme\(\)/);
  assert.match(tabs, /borderTopColor: c\.hairline/);
  assert.match(tabs, /tabBarActiveTintColor: c\.accent/);
});

test("the player card is branded: cream/navy card, Didone title, 18% orbit stamp", () => {
  assert.match(player, /backgroundColor: c\.card, borderColor: c\.border/);
  assert.match(player, /fontFamily: displayFont/);
  assert.match(fonts, /ios: "Didot"/);
  assert.match(player, /backgroundColor: c\.hairline/);
  assert.match(player, /source=\{require\("\.\.\/assets\/brand\/neon-logo-orbit-360-clean\.gif"\)\}/);
  assert.match(player, /width: "18%", height: "18%", right: "4%", bottom: "4%"/);
  assert.match(player, /accessibilityLabel="NEON official show"/);
});

test("the show screen carries the stamp and shows the full player card", () => {
  assert.match(show, /<PlayerCard episode=\{current\} \/>/);
  assert.match(show, /require\("\.\.\/\.\.\/assets\/brand\/neon-logo-orbit-360-clean\.gif"\)/);
  assert.match(show, /width: "18%", height: "18%", right: "4%", bottom: "4%"/);
  assert.match(show, /fontFamily: displayFont/);
  assert.match(show, /styles\.hairline, \{ backgroundColor: c\.hairline \}/);
});
