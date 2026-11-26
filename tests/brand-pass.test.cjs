const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

// E6: login + wizard in the NEON brand, on the E1 tokens.
const css = readFileSync("app/globals.css", "utf8");
const rule = (sel) => {
  const i = css.indexOf(sel + " {");
  assert.ok(i >= 0, `missing ${sel}`);
  return css.slice(i, css.indexOf("}", i));
};

test("wizard question is the Didone display face in the heading color", () => {
  assert.match(rule(".wizard-card h2"), /font-family: var\(--font-display\)/);
  assert.match(rule(".wizard-card h2"), /color: var\(--heading\)/);
});

test("wizard progress is an antique-gold hairline", () => {
  assert.match(rule(".wizard-progress-bar"), /background: var\(--hairline\)/);
  assert.match(rule(".wizard-progress"), /height: 2px/);
});

test("login shows the display-face wordmark and the theme toggle, no inline colors", () => {
  const login = readFileSync("components/LoginForm.tsx", "utf8");
  assert.match(login, /login-wordmark/);
  assert.match(login, /<ThemeToggle \/>/);
  assert.doesNotMatch(login, /style=\{\{[^}]*color/);
  assert.match(rule(".login-wordmark"), /var\(--font-display\)/);
});

test("WizardProgress reports progress to screen readers and clamps its width", async () => {
  const src = readFileSync("components/WizardChrome.tsx", "utf8");
  assert.match(src, /role="progressbar"/);
  assert.match(src, /aria-valuenow=\{current\}/);
  assert.match(src, /Math\.min\(100, Math\.max\(0,/);
});
