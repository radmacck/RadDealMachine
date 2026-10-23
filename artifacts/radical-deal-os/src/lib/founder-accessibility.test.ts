import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const appShell = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../field-desk.css", import.meta.url), "utf8");

test("private shell provides a keyboard skip link to the main content landmark", () => {
  assert.match(appShell, /className="fd-skip-link" href="#main-content">Skip to main content/);
  assert.match(appShell, /<main className="fd-content" id="main-content" tabIndex=\{-1\}>/);
});

test("founder controls retain visible keyboard focus and usable mobile hit targets", () => {
  assert.match(styles, /:focus-visible\s*\{\s*outline:3px solid #1c4940/);
  assert.match(styles, /\.fd-sidebar\s+:is\(a,button,input,select,textarea,summary,\[tabindex\]\):focus-visible\s*\{\s*outline-color:#ddef77/);
  assert.match(styles, /\.fd-nav button, \.fd-nav a \{ min-width:max-content;min-height:44px/);
  assert.match(styles, /\.fd-icon-button \{ width:44px;height:44px; \}/);
  assert.match(styles, /\.fd-status-issue \{ display:inline-flex;max-width:100%;margin-right:auto; \}/);
  assert.match(styles, /\.fd-empty \{[^}]*color:#52635a;font-size:13px;line-height:1\.5;/);
});
