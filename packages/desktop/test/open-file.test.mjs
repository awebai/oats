import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { createFileOpener } from "../renderer/open-file.mjs";
import { createSelectionOwnership } from "../renderer/selection-ownership.mjs";
import * as md from "../renderer/views/markdown.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function picked(content = "# Artifact", name = "same.md", read) {
  const file = new File([content], name);
  if (read) Object.defineProperty(file, "text", { value: () => read.promise });
  for (const key of ["path", "webkitRelativePath"]) Object.defineProperty(file, key, {
    get: () => assert.fail(`must not discover ${key}`),
  });
  return file;
}
function documentFixture(t) {
  const dom = new JSDOM("<!doctype html><body><button>Stable focus</button></body>", { url: "http://127.0.0.1/" });
  t.after(() => { md.unmount(); dom.window.close(); });
  const doc = dom.window.document;
  const host = () => { const el = doc.createElement("div"); doc.body.append(el); return el; };
  return { doc, host, window: dom.window };
}
function chooserFixture(t, openFile) {
  const ui = documentFixture(t);
  const inputs = [], opened = [], reports = [], order = [];
  let workspace = "A", generation = 0;
  const gate = createSelectionOwnership({ currentWorkspace: () => workspace, workspaceGeneration: () => generation });
  // No native dialog: still execute the actual chooser event/lifetime code.
  ui.window.HTMLInputElement.prototype.click = function () { order.push("click"); inputs.push(this); };
  const opener = createFileOpener({ document: ui.doc,
    beginIntent: () => { order.push("intent"); return gate.begin(); },
    openFile: (file, owns) => { opened.push({ file, owns }); return openFile?.(file, owns); },
    report: message => reports.push(message),
  });
  t.after(() => opener.dispose());
  const change = (input, files) => {
    Object.defineProperty(input, "files", { configurable: true, value: files });
    input.dispatchEvent(new ui.window.Event("change"));
  };
  const cancel = input => input.dispatchEvent(new ui.window.Event("cancel"));
  return { ...ui, opener, inputs, opened, reports, order, gate, change, cancel,
    switchWorkspace: value => { workspace = value; ++generation; } };
}

test("chooser clicks synchronously after intent capture; passes the File untouched and an owner", async t => {
  const f = chooserFixture(t);
  f.opener.choose();
  assert.deepEqual(f.order, ["intent", "click"], "no await/import/timer before click");
  const input = f.inputs[0];
  assert.equal(input.type, "file");
  assert.equal(input.multiple, false);
  assert.equal(input.hidden, true);
  assert.equal(input.isConnected, true);
  assert.equal(input.hasAttribute("webkitdirectory"), false);
  const first = picked(), ignored = picked("# ignored");
  f.change(input, [first, ignored]);
  assert.equal(f.opened.length, 1, "one artifact even for a synthetic multi-selection");
  assert.equal(f.opened[0].file, first);
  assert.equal(f.opened[0].owns(), true);
  assert.equal(input.isConnected, false);
  f.change(input, [first]); f.cancel(input);
  await tick();
  assert.equal(f.opened.length, 1, "settled input cannot dispatch twice");
  assert.equal(f.opened[0].owns(), true, "late cancel cannot revoke a picked file");
  assert.deepEqual(f.reports, []);
});

test("cancel/empty selection are quiet and a fresh chooser can pick the same basename again", t => {
  const f = chooserFixture(t);
  const button = f.doc.querySelector("button"); button.focus();
  f.opener.choose(); f.cancel(f.inputs[0]);
  f.opener.choose(); f.change(f.inputs[1], []);
  assert.equal(f.doc.activeElement, button);
  assert.equal(f.doc.querySelector("input"), null);
  assert.deepEqual(f.opened, []); assert.deepEqual(f.reports, []);
  const one = picked("# From directory one"), two = picked("# From directory two");
  f.opener.choose(); f.change(f.inputs[2], [one]);
  f.opener.choose(); f.change(f.inputs[3], [two]);
  assert.notEqual(f.inputs[2], f.inputs[3], "fresh input also allows same-file re-picks");
  assert.deepEqual(f.opened.map(x => x.file), [one, two], "never deduplicate by basename");
  assert.equal(f.opened[0].owns(), false);
  assert.equal(f.opened[1].owns(), true);
});

for (const cause of ["new-chooser", "selection", "workspace", "A-B-A", "dispose"]) {
  test(`chooser ignores stale selection and cancel after ${cause}`, t => {
    const f = chooserFixture(t);
    f.opener.choose(); const old = f.inputs[0];
    if (cause === "new-chooser") f.opener.choose();
    if (cause === "selection") f.gate.invalidate();
    if (cause === "workspace") f.switchWorkspace("B");
    if (cause === "A-B-A") { f.switchWorkspace("B"); f.switchWorkspace("A"); }
    if (cause === "dispose") f.opener.dispose();
    f.change(old, [picked()]); f.cancel(old);
    assert.deepEqual(f.opened, []); assert.deepEqual(f.reports, []);
    if (cause === "new-chooser") {
      const latest = f.inputs[1];
      assert.equal(latest.isConnected, true, "old cleanup cannot remove current input");
      f.change(latest, [picked()]);
      assert.equal(f.opened[0].owns(), true);
    }
    if (cause === "dispose") { f.opener.choose(); assert.equal(f.inputs.length, 1); }
  });
}

for (const cause of ["owned", "new-chooser", "selection", "A-B-A", "dispose"]) test(`open callback rejection after ${cause} respects the dispatch owner`, async t => {
  const read = deferred();
  const f = chooserFixture(t, () => read.promise);
  f.opener.choose(); f.change(f.inputs[0], [picked()]);
  if (cause === "new-chooser") f.opener.choose();
  if (cause === "selection") f.gate.invalidate();
  if (cause === "A-B-A") { f.switchWorkspace("B"); f.switchWorkspace("A"); }
  if (cause === "dispose") f.opener.dispose();
  read.reject(new Error("secret-token and /private/native/path"));
  await tick();
  assert.equal(f.opened[0].owns(), cause === "owned");
  assert.equal(f.reports.length, cause === "owned" ? 1 : 0);
  assert.ok(f.reports.every(message => /Could not open/.test(message) && !/secret|private/.test(message)));
});

test("chooser and synchronous callback failures are contained without leaking exception details", t => {
  const f = chooserFixture(t, () => { throw new Error("credential"); });
  f.opener.choose(); f.change(f.inputs[0], [picked()]);
  f.window.HTMLInputElement.prototype.click = () => { throw new Error("credential"); };
  f.opener.choose();
  assert.equal(f.reports.length, 2);
  assert.ok(f.reports.every(message => !message.includes("credential")));
  assert.equal(f.doc.querySelector("input"), null);
});

test("renderer read cap and Markdown extensions mirror the server's existing file contract", async () => {
  const server = readFileSync(new URL("../server/oats-web.mjs", import.meta.url), "utf8");
  const expression = server.match(/const FILE_MAX_BYTES = ([^;]+);/)[1];
  assert.equal(md.FILE_MAX_BYTES, runInNewContext(expression));
  assert.equal(md.FILE_MAX_BYTES, 2 * 1024 * 1024);
  const extensions = JSON.parse(server.match(/const MARKDOWN_EXT = new Set\((\[[^\]]+\])\)/)[1]);
  for (const ext of extensions) assert.equal((await md.readPickedFile(picked("# hi", `file${ext.toUpperCase()}`))).markdown, true);
  assert.equal((await md.readPickedFile(picked("hi", "file.txt"))).markdown, false);
  const atLimit = await md.readPickedFile(picked("x".repeat(md.FILE_MAX_BYTES), "limit.txt"));
  assert.equal(atLimit.content.length, md.FILE_MAX_BYTES);
  let read = false;
  await assert.rejects(md.readPickedFile({ name: "huge.txt", size: md.FILE_MAX_BYTES + 1,
    text: () => { read = true; return ""; } }), /too large.*2 MiB/);
  assert.equal(read, false, "oversized File is refused BEFORE reading");
  await assert.rejects(md.readPickedFile({ name: "multibyte.txt", size: 1,
    text: async () => "é".repeat(md.FILE_MAX_BYTES / 2 + 1) }), /too large/);
  await assert.rejects(md.readPickedFile(picked("plain\0binary", "binary.txt")), /Binary.*NUL/);
});

test("picked Markdown is sanitized, basename-only and never resolves local links or embedded resources", async t => {
  const { doc, host } = documentFixture(t);
  const el = host();
  const content = `# Artifact
[relative](../soul/TASK.md) [absolute](/private/a.md) [fragment](#artifact)
[external](https://example.com/help) [active](javascript:alert%281%29)
<a href="#" data-open-file="/private/credentials" target="_top">forged</a>
<a href="relative.md">raw relative</a>
<a href="https://example.com" target="_self" rel="opener">raw external</a>
<img src="https://example.com/leak?token=SECRET" onerror="bad()">
<svg><image href="https://example.com/leak?token=SECRET" /></svg>
<p style="background:url(https://example.com/leak?token=SECRET)" onclick="bad()">styled</p>
<script>bad()</script><input value="save"><iframe src="https://example.com"></iframe>
<textarea>editor</textarea><select><option>save</option></select><div contenteditable="true" autofocus>editable</div>

\`\`\`js
const answer = 42;
\`\`\``;
  const name = '<img onerror="bad()">.MD';
  const dispose = await md.mount(el, {
    pickedFile: picked(content, name), path: "/must/not/use/this.md",
    api: () => assert.fail("picked file must not call the backend"),
    openFile: () => assert.fail("picked file has no authorized local navigation"),
    openTerminal: () => assert.fail("no terminal handoff"),
  });
  assert.equal(el.querySelector(".crumb").textContent, name);
  assert.match(el.querySelector(".mdv-meta").textContent, /Read-only · browser-selected file/);
  assert.match(el.querySelector(".mdv-meta").textContent, /Full path unavailable/);
  assert.ok(!el.innerHTML.includes("/must/not/use"));
  assert.equal(el.querySelector("a[data-open-file], script, img, svg, iframe, input, textarea, select, [onclick], [onerror], [contenteditable], [autofocus]"), null);
  assert.ok(!el.querySelector(".mdv").innerHTML.includes("SECRET"), "no automatic resource request source remains");
  for (const label of ["relative", "absolute", "forged", "raw relative", "active"]) {
    assert.ok(el.textContent.includes(label));
    assert.ok(![...el.querySelectorAll("a")].some(a => a.textContent === label), `${label} is plain text`);
  }
  for (const a of el.querySelectorAll('a[href^="https:"]')) {
    assert.equal(a.target, "_blank"); assert.equal(a.rel, "noreferrer noopener");
  }
  assert.ok(el.querySelector("code .hljs-keyword"));
  const heading = el.querySelector("h1"); let scrolled = 0;
  heading.scrollIntoView = () => { scrolled++; };
  [...el.querySelectorAll("a")].find(a => a.textContent === "fragment").click();
  assert.equal(scrolled, 1);
  assert.equal(doc.querySelectorAll(".md-copy").length, 1, "only existing read-only code-copy control");
  dispose();
});

test("picked code/plaintext stays read-only and same-named mounts remain independent", async t => {
  const { host } = documentFixture(t);
  const a = host(), b = host();
  const d1 = await md.mount(a, { pickedFile: picked('const label = "<script>bad()</script>";', "same.js") });
  const d2 = await md.mount(b, { pickedFile: picked("// second artifact", "same.js") });
  assert.match(a.querySelector("code").textContent, /const label/);
  assert.equal(a.querySelector("script, input, textarea, [contenteditable]"), null);
  assert.ok(a.querySelector(".hljs-keyword"));
  d1(); d1();
  assert.equal(a.children.length, 0);
  assert.match(b.querySelector("code").textContent, /second artifact/);
  d2();
});

test("path-backed Response API and relative/raw local links still work beside a picked file", async t => {
  const { host } = documentFixture(t);
  const a = host(), b = host(), requests = [], opened = [];
  const disposeA = await md.mount(a, { path: "/ws/docs/a.md", openFile: path => opened.push(path), api: async path => {
    requests.push(path);
    return { json: async () => ({ path: "/ws/docs/a.md", name: "a.md", markdown: true, size: 9,
      content: '[next](../next.md#title) <a data-open-file="/ws/raw.md" href="#">raw</a>' }) };
  } });
  const disposeB = await md.mount(b, { pickedFile: picked() });
  for (const link of a.querySelectorAll("a[data-open-file]")) link.click();
  assert.deepEqual(requests, ["/api/file?path=%2Fws%2Fdocs%2Fa.md"]);
  assert.deepEqual(opened, ["/ws/next.md", "/ws/raw.md"]);
  assert.equal(a.querySelector(".crumb").textContent, "/ws/docs/a.md");
  disposeB();
  assert.ok(a.querySelector(".mdv"));
  disposeA();
});

for (const failure of [false, true]) for (const mode of ["dispose", "selection", "A-B-A"]) {
  test(`picked read ${failure ? "rejection" : "success"} after ${mode} cannot paint or damage a newer mount`, async t => {
    const { host } = documentFixture(t);
    let workspace = "A", generation = 0;
    const gate = createSelectionOwnership({ currentWorkspace: () => workspace, workspaceGeneration: () => generation });
    const read = deferred(), a = host();
    const mounting = md.mount(a, { pickedFile: picked("# older", "old.md", read), owns: gate.begin() });
    const root = a.querySelector(".mdv"), before = root.innerHTML;
    if (mode === "dispose") md.unmount();
    if (mode === "selection") gate.invalidate();
    if (mode === "A-B-A") { workspace = "B"; generation++; workspace = "A"; generation++; }
    const b = host(); const d2 = await md.mount(b, { pickedFile: picked("# newer") });
    const newer = b.innerHTML;
    if (failure) read.reject(new Error("stale secret")); else read.resolve("# stale success");
    const d1 = await mounting;
    assert.equal(root.innerHTML, before, "even detached roots must not receive stale paints");
    assert.equal(b.innerHTML, newer);
    d1(); assert.equal(b.innerHTML, newer, "old disposer never touches new mount"); d2();
  });
}

for (const failure of [false, true]) test(`legacy API ${failure ? "failure" : "success"} after disposal is also guarded`, async t => {
  const { host } = documentFixture(t), read = deferred(), el = host();
  const mounting = md.mount(el, { path: "/ws/a.md", api: () => read.promise });
  const root = el.querySelector(".mdv"), before = root.innerHTML;
  md.unmount();
  if (failure) read.reject(new Error("late error")); else read.resolve({ name: "a.md", path: "/ws/a.md", size: 1, markdown: true, content: "# late" });
  const dispose = await mounting;
  assert.equal(root.innerHTML, before);
  dispose();
});

test("owned picked read failure shows only a readable error; binary and oversized files are refused in the view", async t => {
  const { host } = documentFixture(t);
  for (const [file, expected] of [
    [picked("a\0b"), /Binary files/],
    [picked("x".repeat(md.FILE_MAX_BYTES + 1)), /maximum 2 MiB/],
    [{ name: "private.md", size: 1, text: async () => { throw new Error("CREDENTIAL /private/path"); } }, /could not be read/],
  ]) {
    const el = host();
    const dispose = await md.mount(el, { pickedFile: file });
    assert.match(el.querySelector(".mdv-error").textContent, expected);
    assert.ok(!/CREDENTIAL|\/private\/path/.test(el.textContent));
    assert.equal(el.querySelector("code, h1"), null);
    dispose();
  }
});

for (const reject of [false, true]) test(`late code-copy ${reject ? "rejection" : "success"} does not modify a disposed mount`, async t => {
  const { doc, host } = documentFixture(t), copying = deferred(), sent = [];
  Object.defineProperty(doc.defaultView.navigator, "clipboard", { value: {
    writeText: text => { sent.push(text); return copying.promise; },
  } });
  const el = host(); const dispose = await md.mount(el, { pickedFile: picked("const n = 1;", "code.js") });
  const button = el.querySelector(".md-copy"); button.click();
  assert.deepEqual(sent, ["const n = 1;"]);
  dispose();
  if (reject) copying.reject(new Error("unavailable")); else copying.resolve();
  await tick();
  assert.equal(button.textContent, "copy");
});
