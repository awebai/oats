import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { mount } from "../renderer/views/markdown.mjs";
import { createTabChrome } from "../renderer/tab-a11y.mjs";

const shellCss = readFileSync(new URL("../renderer/shell.css", import.meta.url), "utf8");
const sample = `// Read-only supporting code
function greet(name) {
  const message = "hello";
  return message + 42;
}`;

function fixture(t, css = "") {
  const dom = new JSDOM("<!doctype html><html><head></head><body><main></main></body></html>", {
    url: "http://127.0.0.1/",
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const style = doc.createElement("style");
  style.textContent = css;
  doc.head.append(style);
  return { doc, window: dom.window, host: doc.querySelector("main") };
}

function declaration(doc, selector, property) {
  const rules = [...doc.styleSheets].flatMap(sheet => [...sheet.cssRules]);
  const rule = rules.find(rule => rule.selectorText === selector);
  assert.ok(rule, `shipped stylesheet contains ${selector}`);
  return rule.style.getPropertyValue(property);
}

test("Souls toolbar can wrap instead of overflowing the narrow workspace stage", t => {
  const source = readFileSync(new URL("../renderer/views/spawn.mjs", import.meta.url), "utf8");
  const css = source.match(/const CSS = `([\s\S]*?)`;/)[1];
  const { doc, host, window } = fixture(t, css);
  const bar = doc.createElement("div"); bar.className = "souls-bar"; host.append(bar);
  assert.equal(window.getComputedStyle(bar).flexWrap, "wrap");
  assert.equal(declaration(doc, ".souls-bar", "height"), "", "no fixed one-row height after wrapping");
  assert.equal(declaration(doc, ".souls-bar", "min-height"), "", "compact toolbar does not impose a second 48px row");
});

// jsdom exercises the shipped markup + CSS cascade, not browser layout or
// resolved custom-property colors. theme-contrast.test.mjs separately resolves
// both palettes and composites md-code-bg over the view's painted background.
for (const kind of ["picked JavaScript", "picked Markdown", "path Markdown"]) {
  test(`${kind}: real highlight markup receives semantic colors and stays read-only`, async t => {
    const { doc, host, window } = fixture(t);
    const copies = [], requests = [];
    Object.defineProperty(window.navigator, "clipboard", { value: {
      writeText: async text => { copies.push(text); },
    } });
    const markdown = kind !== "picked JavaScript";
    const content = markdown ? `# Supporting document\n\n\`\`\`js\n${sample}\n\`\`\`\n
<a href="https://example.com/help" target="_self" rel="opener" onclick="bad()">external</a>
<script>bad()</script><img src=x onerror="bad()"><button>Save</button>` : sample;
    const name = markdown ? "notes.md" : "support.js";
    const ctx = {
      api: async path => {
        requests.push(path);
        assert.equal(kind, "path Markdown", "browser picks never call the API");
        return { path: "/ws/notes.md", name, markdown, content, size: content.length };
      },
      openFile: () => assert.fail("coloring never navigates to another file"),
      openTerminal: () => assert.fail("read-only code must never be sent to a terminal"),
      ...(kind === "path Markdown" ? { path: "/ws/notes.md" } : { pickedFile: new File([content], name) }),
    };
    const dispose = await mount(host, ctx);
    t.after(dispose);
    const code = host.querySelector("pre.md-code > code.hljs");
    assert.equal(code.textContent, sample, "highlighting preserves the exact code text");
    for (const [selector, token] of [
      ["code.hljs", "fg"], [".hljs-comment", "muted"], [".hljs-keyword", "violet"],
      [".hljs-title", "accent"], [".hljs-string", "ok"], [".hljs-number", "warn"], [".hljs-params", "fg"],
    ]) {
      const node = host.querySelector(selector);
      assert.ok(node, `real highlighter emits ${selector}`);
      assert.equal(window.getComputedStyle(node).color, `var(--${token})`, `${selector} is not monochrome`);
    }
    assert.equal(declaration(doc, ".mdv-scroll", "background"), "var(--bg)");
    assert.equal(declaration(doc, ".mdv pre.md-code", "background"), "var(--md-code-bg)");
    assert.equal(host.querySelector(".mdv script, input, textarea, select, [contenteditable], [onclick], [onerror]"), null);
    if (markdown) {
      const external = host.querySelector('a[href="https://example.com/help"]');
      assert.equal(external.target, "_blank");
      assert.equal(external.rel, "noreferrer noopener", "raw external anchors remain sanitized");
    }
    const controls = [...host.querySelectorAll("button")];
    assert.equal(controls.length, 1, "only a copy control; no editor/save/terminal-send controls");
    assert.equal(controls[0].getAttribute("aria-label"), "Copy code block");
    controls[0].click();
    await Promise.resolve();
    assert.deepEqual(copies, [sample], "copy exports original text, not highlighter markup");
    assert.deepEqual(requests, kind === "path Markdown" ? ["/api/file?path=%2Fws%2Fnotes.md"] : []);
  });
}

test("standard hljs scopes are styled locally, including nested meta and substitution tokens", async t => {
  const { doc, host, window } = fixture(t);
  t.after(await mount(host, { pickedFile: new File([sample], "support.js") }));
  const code = host.querySelector("code.hljs");
  const scopes = {
    fg: ["subst", "params", "property", "punctuation", "operator", "tag", "template-tag", "code"],
    muted: ["comment", "quote"],
    violet: ["keyword", "selector-tag", "doctag", "meta"],
    accent: ["title", "section", "name", "attr", "attribute", "selector-id", "selector-class", "selector-attr", "selector-pseudo", "link"],
    ok: ["string", "regexp", "addition"],
    warn: ["number", "literal", "type", "built_in", "symbol", "bullet", "variable", "template-variable", "deletion"],
  };
  for (const [token, categories] of Object.entries(scopes)) {
    for (const category of categories) {
      const span = doc.createElement("span");
      span.className = `hljs-${category}`;
      span.textContent = category;
      code.append(span);
      assert.equal(window.getComputedStyle(span).color, `var(--${token})`, category);
    }
  }
  const meta = doc.createElement("span");
  meta.className = "hljs-meta";
  meta.innerHTML = '<span class="hljs-keyword">include</span><span class="hljs-string">header</span>';
  code.append(meta);
  assert.equal(window.getComputedStyle(meta.firstChild).color, "var(--violet)");
  assert.equal(window.getComputedStyle(meta.lastChild).color, "var(--ok)");
  const template = doc.createElement("span");
  template.className = "hljs-string";
  template.innerHTML = '<span class="hljs-subst">value</span>';
  code.append(template);
  assert.equal(window.getComputedStyle(template.firstChild).color, "var(--fg)");
  const outside = doc.createElement("span");
  outside.className = "hljs-keyword";
  host.append(outside);
  assert.notEqual(window.getComputedStyle(outside).color, "var(--violet)", "reader styles do not leak outside .mdv");
});

test("flat and grouped strips preserve intrinsic tab sizing and scroll instead of compressing labels", t => {
  const { doc, host, window } = fixture(t, shellCss);
  for (const grouped of [false, true]) {
    const bar = doc.createElement("div");
    if (grouped) bar.className = "group-tabbar";
    else bar.id = "tabbar";
    // The report's 165.5px group size is a fixture constraint, not a claim that
    // jsdom performs layout or that arbitrary tiny terminal panes are usable.
    bar.style.width = "165.5px";
    const tabs = ["⌗ A-reviewer", "⌗ A-desktop-engineer-with-a-long-name"].map((title, i) =>
      createTabChrome(doc, `${grouped}-${i}`, title));
    for (const tab of tabs) bar.append(tab.tabEl);
    const actions = doc.createElement("div");
    actions.id = "tab-actions";
    const control = doc.createElement("button");
    control.textContent = "Split";
    actions.append(control);
    bar.append(actions);
    host.append(bar);
    assert.equal(window.getComputedStyle(bar).overflowX, "auto");
    assert.equal(window.getComputedStyle(bar).minWidth, "0px");
    for (const { tabEl, triggerEl, closeEl } of tabs) {
      const style = window.getComputedStyle(tabEl);
      assert.equal(style.flexShrink, "0", "tab identity cannot shrink to A-… under strip pressure");
      assert.equal(style.flexGrow, "0");
      assert.equal(style.flexBasis, "auto", "preserve content-based width, not equal-width slots");
      assert.equal(style.maxWidth, "240px", "existing long-label cap is unchanged");
      assert.equal(style.whiteSpace, "nowrap");
      assert.equal(window.getComputedStyle(triggerEl).textOverflow, "ellipsis", "long labels retain the existing cap");
      assert.equal(window.getComputedStyle(closeEl).flexShrink, "0", "Close remains a usable control within the cap");
    }
    assert.equal(window.getComputedStyle(actions).flexShrink, "0", "do not remove or compress group controls");
    assert.deepEqual([...bar.children], [...tabs.map(tab => tab.tabEl), actions], "no reordering or auto-collapse");
    bar.remove();
  }
});
