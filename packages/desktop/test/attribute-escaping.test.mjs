// Attribute-context escaping: every value interpolated into a QUOTED
// attribute must stay inside it. Hostile workspace ids and agent-prose
// markdown links must never mint an extra attribute (data-open-file,
// data-action, handlers) in the privileged window. jsdom only; no GUI/CLI.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { escapeHtml, renderWorkspaceSelect } from "../renderer/views/common.mjs";
import * as md from "../renderer/views/markdown.mjs";

const HOSTILE = [
  `/tmp/a"b" data-action="x`,
  `/tmp/a'b' data-action='x`,
  `x" onpointerenter="window.__pwned=1`,
  `"><img src=x onerror=bad()>`,
  `&quot;" data-open-file="/etc/passwd`,
];

function attributesOf(html, doc) {
  const host = doc.createElement("div"); host.innerHTML = html;
  return host.firstElementChild;
}

test("escapeHtml keeps any value inside a double- or single-quoted attribute and in text", () => {
  const doc = new JSDOM("<!doctype html><body>").window.document;
  for (const value of HOSTILE) {
    for (const quote of [`"`, `'`]) {
      const el = attributesOf(`<a title=${quote}${escapeHtml(value)}${quote}>${escapeHtml(value)}</a>`, doc);
      assert.deepEqual(el.getAttributeNames(), ["title"], `${quote}-quoted: ${value}`);
      assert.equal(el.getAttribute("title"), value, "the value round-trips exactly");
      assert.equal(el.textContent, value);
      assert.equal(el.children.length, 0);
    }
  }
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(md.escapeHtml, escapeHtml, "markdown uses the one shared escaper");
});

test("workspace switcher: a hostile workspace id stays one option value, never markup", () => {
  const doc = new JSDOM("<!doctype html><body><select id=s></select>").window.document;
  const select = doc.getElementById("s");
  const list = HOSTILE.map((id, i) => ({ id, name: `ws ${i} ${id}`, team: i === 0 ? { name: `t"eam' data-action="y` } : null }));
  renderWorkspaceSelect(select, list, HOSTILE[1]);
  const options = [...select.options];
  assert.deepEqual(options.map(o => o.value), HOSTILE);
  assert.equal(options[0].textContent, `ws 0 ${HOSTILE[0]} · t"eam' data-action="y`);
  for (const o of options) assert.deepEqual(o.getAttributeNames().filter(n => n !== "value"), [], "no injected attribute");
  assert.equal(select.querySelector("[data-action],[data-open-file],[onpointerenter],img"), null);
  assert.equal(select.value, HOSTILE[1]);
  // unchanged list: no rebuild (keeps the open/selected native state)
  const first = select.options[0]; renderWorkspaceSelect(select, list, HOSTILE[2]);
  assert.equal(select.options[0], first); assert.equal(select.value, HOSTILE[2]);
});

test("markdown links from agent prose: quotes in href or title never inject attributes", async t => {
  const dom = new JSDOM("<!doctype html><body><div id=el></div>", { url: "http://127.0.0.1/" });
  t.after(() => { md.unmount(); dom.window.close(); });
  const el = dom.window.document.getElementById("el");
  const content = [
    `[ext](<https://example.com/a" data-action="x> "t\\" data-action=\\"x")`,
    `[rel](<docs/a" data-action="x.md> "it's \\" data-open-file=\\"/etc/passwd")`,
    `[single](notes.md 'o\\'k\\' data-action=\\'x')`,
    `[frag](<#s" data-action="x>)`,
  ].join("\n\n");
  await md.mount(el, {
    path: "/ws/docs/readme.md",
    api: async () => ({ markdown: true, content, path: "/ws/docs/readme.md", name: "readme.md", size: content.length }),
    openFile() {}, openTerminal() {},
  });
  const anchors = [...el.querySelectorAll(".mdv a:not(.hanchor)")];
  assert.ok(anchors.length >= 3, "the links render as links");
  const allowed = new Set(["href", "title", "target", "rel", "data-open-file"]);
  for (const a of anchors) {
    for (const name of a.getAttributeNames()) assert.ok(allowed.has(name), `unexpected ${name} on ${a.outerHTML}`);
  }
  assert.equal(el.querySelector("[data-action]"), null, "no injected data-action anywhere");
  const byText = text => anchors.find(a => a.textContent === text);
  assert.equal(byText("ext")?.getAttribute("title"), `t" data-action="x`);
  const rel = byText("rel");
  assert.equal(rel.getAttribute("title"), `it's " data-open-file="/etc/passwd`);
  assert.equal(rel.getAttribute("data-open-file"), `/ws/docs/docs/a" data-action="x.md`, "the one data-open-file is the resolved link, verbatim");
  assert.equal(el.querySelectorAll('[data-open-file="/etc/passwd"]').length, 0);
});

// In-memory mutant of the shipped escaper: without quote escaping the
// switcher-context assertions above must fail (no file is modified).
test("mutation: dropping quote escaping is caught by the attribute round-trip", async () => {
  const source = readFileSync(new URL("../renderer/views/common.mjs", import.meta.url), "utf8");
  const from = `\n    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");`;
  assert.equal(source.split(from).length, 2, "mutate exactly the quote-escaping step");
  const mutant = await import(`data:text/javascript;base64,${Buffer.from(source.replace(from, ";")).toString("base64")}`);
  const doc = new JSDOM("<!doctype html><body>").window.document;
  const el = attributesOf(`<a title="${mutant.escapeHtml(HOSTILE[0])}">x</a>`, doc);
  assert.notDeepEqual(el.getAttributeNames(), ["title"], "the unescaped quote breaks out of the attribute");
});
