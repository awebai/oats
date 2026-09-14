// Isolated renderer module + CSSOM only; no OS, browser, app or real storage.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../renderer/theme.mjs", import.meta.url), "utf8");
const html = readFileSync(new URL("../renderer/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../renderer/theme.css", import.meta.url), "utf8");
const KEY = "oatsweb.theme";
function fixture(t, { saved = null, readError = false, writeError = false, noStorage = false, osDark = true } = {}) {
  const dom = new JSDOM(html); // scripts and external resource loading disabled
  t.after(() => dom.window.close());
  const style = dom.window.document.createElement("style");
  style.textContent = css; dom.window.document.head.append(style);
  const reads = [], writes = [], osListeners = [];
  let mediaQueries = 0;
  const context = {
    document: dom.window.document,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    window: { matchMedia() { mediaQueries++; return {
      matches: osDark, addEventListener: (_, fn) => osListeners.push(fn),
    }; } },
  };
  if (!noStorage) context.localStorage = {
    getItem(key) { reads.push(key); if (readError) throw new Error("storage blocked"); return saved; },
    setItem(key, value) { writes.push([key, value]); if (writeError) throw new Error("storage full"); saved = value; },
  };
  const theme = runInNewContext(`${source.replace(/\bexport /g, "")}\n({
    THEMES, initTheme, currentTheme, applyTheme, setTheme, toggleTheme, onThemeChange, xtermTheme
  })`, context);
  return { theme, doc: context.document, reads, writes,
    mediaQueries: () => mediaQueries,
    changeOS(dark) { for (const listener of osListeners) listener({ matches: dark }); },
  };
}

test("initial HTML is White before scripts run; public choices have stable labels and order", t => {
  const { doc, theme } = fixture(t);
  assert.equal(doc.documentElement.dataset.theme, "light");
  assert.equal(theme.currentTheme(), "light");
  assert.deepEqual(Array.from(theme.THEMES, item => [item.id, item.label]), [
    ["light", "White"], ["solarized", "Solarized"], ["dark", "Dark"],
  ]);
  assert.ok(Object.isFrozen(theme.THEMES));
  for (const item of theme.THEMES) assert.ok(Object.isFrozen(item));
});

for (const osDark of [false, true]) {
  for (const saved of [null, "", "bogus", "LIGHT", "white", "system", "__proto__", "#ff0000", " dark "]) {
    test(`OS ${osDark ? "dark" : "light"}, invalid/missing ${JSON.stringify(saved)} defaults to White`, t => {
      const u = fixture(t, { saved, osDark });
      u.doc.documentElement.dataset.theme = "dark";
      assert.equal(u.theme.initTheme(), "light");
      assert.equal(u.doc.documentElement.dataset.theme, "light");
      u.changeOS(true); u.changeOS(false);
      assert.equal(u.theme.currentTheme(), "light");
      assert.equal(u.mediaQueries(), 0, "OS preference is not consulted or subscribed");
      assert.deepEqual(u.reads, [KEY]);
      assert.deepEqual(u.writes, [], "initialization doesn't rewrite preferences");
    });
  }
}
for (const saved of ["light", "solarized", "dark"]) test(`honors saved ${saved} via the legacy key`, t => {
  const u = fixture(t, { saved });
  assert.equal(u.theme.initTheme(), saved);
  u.changeOS(true); u.changeOS(false);
  assert.equal(u.theme.currentTheme(), saved);
  assert.deepEqual(u.reads, [KEY]);
  assert.deepEqual(u.writes, []);
});

for (const storage of [{}, { readError: true }, { writeError: true }, { noStorage: true }]) {
  test(`storage ${JSON.stringify(storage)}: selection and cycling remain usable`, t => {
    const u = fixture(t, storage);
    assert.equal(u.theme.initTheme(), "light");
    for (const expected of ["solarized", "dark", "light", "solarized"]) {
      assert.equal(u.theme.toggleTheme(), expected);
      assert.equal(u.theme.currentTheme(), expected);
    }
    assert.equal(u.theme.setTheme("dark"), "dark");
    assert.equal(u.theme.currentTheme(), "dark");
    if (!storage.noStorage) assert.deepEqual(u.writes, ["solarized", "dark", "light", "solarized", "dark"].map(value => [KEY, value]));
  });
}

test("public application/selection never project arbitrary names; applyTheme remains non-persisting", t => {
  const u = fixture(t);
  assert.equal(u.theme.applyTheme("solarized"), "solarized");
  assert.deepEqual(u.writes, []);
  for (const invalid of [undefined, null, {}, ["dark"], 1, "WHITE", "__proto__", "red; background:url(x)"]) {
    assert.equal(u.theme.setTheme(invalid), "light");
    assert.equal(u.doc.documentElement.dataset.theme, "light");
  }
  u.doc.documentElement.dataset.theme = "corrupt";
  assert.equal(u.theme.currentTheme(), "light");
  assert.equal(u.theme.toggleTheme(), "solarized");
  assert.equal(u.theme.applyTheme("invalid"), "light");
});

test("listeners receive validated live themes, survive failures and unsubscribe", t => {
  const u = fixture(t, { writeError: true });
  const events = [];
  const offBroken = u.theme.onThemeChange(() => { throw new Error("inert listener failed"); });
  const off = u.theme.onThemeChange(name => events.push([name, u.theme.currentTheme()]));
  u.theme.setTheme("solarized"); u.theme.toggleTheme(); u.theme.setTheme("not-a-theme");
  assert.deepEqual(events, [["solarized", "solarized"], ["dark", "dark"], ["light", "light"]]);
  off(); offBroken(); u.theme.toggleTheme();
  assert.equal(events.length, 3);
});

test("xterm follows all three live CSS palettes including selection and all 16 ANSI tokens", t => {
  const u = fixture(t);
  const cssTokens = name => Object.fromEntries([...css.match(new RegExp(`\\[data-theme="${name}"\\] \\{([\\s\\S]*?)\\n\\}`))[1]
    .matchAll(/--([\w-]+):\s*(#[0-9a-f]{6}(?:[0-9a-f]{2})?)\b/gi)].map(match => [match[1], match[2]]));
  const projections = { background: "term-bg", foreground: "term-fg", cursor: "term-fg", cursorAccent: "term-bg", selectionBackground: "term-sel", selectionForeground: "term-sel-fg" };
  const changes = [];
  const off = u.theme.onThemeChange(() => changes.push(u.theme.xtermTheme()));
  t.after(off);
  for (const name of ["light", "solarized", "dark"]) {
    u.theme.setTheme(name);
    const result = changes.at(-1), tokens = cssTokens(name);
    assert.equal(Object.keys(result).length, 22);
    for (const [field, token] of Object.entries(projections)) assert.equal(result[field], tokens[token], `${name} ${field}`);
    for (const [token, value] of Object.entries(tokens).filter(([token]) => token.startsWith("ansi-"))) {
      const field = token.slice(5).replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
      assert.equal(result[field], value, `${name} ${field}`);
    }
  }
});
