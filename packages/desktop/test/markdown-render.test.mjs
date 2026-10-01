// The Markdown viewer's render pipeline, exported for the capability page's
// Contents reader: sanitising, link routing, rooted links, strict mode for
// untrusted capability text, code files and post-render decoration.
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  renderMarkdownHtml, renderCodeHtml, isMarkdownName, decorateMarkdown, MARKDOWN_CSS,
} from "../renderer/views/markdown.mjs";

const newDoc = () => new JSDOM("<!doctype html><body>").window.document;
function fragment(html) {
  const doc = newDoc();
  const div = doc.createElement("div");
  div.innerHTML = html;
  return div;
}

test("renderMarkdownHtml sanitizes scripts, handlers and active schemes", () => {
  const html = renderMarkdownHtml(
    "<script>alert(1)</script>\n\n<img src=x onerror=\"alert(2)\">\n\n[bad](javascript:alert(3)) [d](data:text/html,x)\n",
    newDoc(), { path: "/ws/a.md" });
  const div = fragment(html);
  assert.equal(div.querySelector("script"), null);
  for (const el of div.querySelectorAll("*")) {
    for (const attr of el.attributes) assert.ok(!/^on/i.test(attr.name), `${el.tagName} keeps ${attr.name}`);
  }
  assert.ok(!/javascript:|data:text/.test(html));
  assert.match(div.textContent, /bad/, "an unsafe link keeps its label as text");
  assert.equal([...div.querySelectorAll("a")].length, 0);
});

test("relative links resolve against the file's directory", () => {
  const div = fragment(renderMarkdownHtml("[b](../b/SKILL.md) [same](./ref.md#part)", newDoc(), { path: "/skills/a/SKILL.md" }));
  const links = [...div.querySelectorAll("a[data-open-file]")];
  assert.deepEqual(links.map(a => a.getAttribute("data-open-file")), ["/skills/b/SKILL.md", "/skills/a/ref.md"]);
  for (const a of links) {
    assert.equal(a.getAttribute("href"), "#");
    assert.equal(a.hasAttribute("target"), false);
  }
});

test("rootedLinks:false renders absolute paths as plain text; default keeps them", () => {
  const src = "[secret](/etc/passwd) [rel](b.md)";
  const strict = fragment(renderMarkdownHtml(src, newDoc(), { path: "/skills/a/SKILL.md", rootedLinks: false }));
  assert.deepEqual([...strict.querySelectorAll("a")].map(a => a.getAttribute("data-open-file")), ["/skills/a/b.md"]);
  assert.match(strict.textContent, /secret/);
  const viewer = fragment(renderMarkdownHtml(src, newDoc(), { path: "/skills/a/SKILL.md" }));
  assert.deepEqual([...viewer.querySelectorAll("a")].map(a => a.getAttribute("data-open-file")), ["/etc/passwd", "/skills/a/b.md"]);
});

test("external links open in a new window without referrer or opener", () => {
  const a = fragment(renderMarkdownHtml("[site](https://example.com/x)", newDoc(), { path: "/a.md" })).querySelector("a");
  assert.equal(a.getAttribute("href"), "https://example.com/x");
  assert.equal(a.getAttribute("target"), "_blank");
  assert.equal(a.getAttribute("rel"), "noreferrer noopener");
});

test("fenced code is highlighted", () => {
  const div = fragment(renderMarkdownHtml("```js\nconst x = \"<b>\";\n```\n", newDoc(), { path: "/a.md" }));
  const code = div.querySelector("pre.md-code > code.hljs");
  assert.ok(code);
  assert.ok(code.querySelector(".hljs-keyword"), "keyword span");
  assert.equal(code.textContent, 'const x = "<b>";');
  assert.equal(div.querySelector("b"), null);
});

test("strict: no raw HTML, no scripts, no images, no resource attributes", () => {
  const skill = [
    "---", "name: x", "---", "# Skill", "",
    '<img src="https://example.com/x.png">', "",
    "![a](https://example.com/y.png) and ![rel](./z.png) and ![ref][r]", "",
    "<script>alert(1)</script>", "",
    '<p onerror="x()">para</p>', "",
    'inline <span style="background:url(https://e.com/t)">s</span> <script>a<b</script> <iframe src="https://e.com"></iframe>', "",
    '<picture><source srcset="https://e.com/s.png"></picture> <video poster="https://e.com/p.png"></video>', "",
    "[r]: https://example.com/r.png", "",
    "[open](../b/SKILL.md) [site](https://example.com)", "",
  ].join("\n");
  const html = renderMarkdownHtml(skill, newDoc(), { path: "/skills/a/SKILL.md", strict: true, rootedLinks: false });
  // Insert into a live document: jsdom would load nothing anyway, so assert
  // the structural property that guarantees no fetch — nothing carries one.
  const dom = new JSDOM("<!doctype html><body>");
  const host = dom.window.document.body;
  host.innerHTML = html;
  for (const sel of ["img", "script", "iframe", "picture", "source", "video", "style", "svg"]) {
    assert.equal(host.querySelector(sel), null, `no <${sel}>`);
  }
  for (const el of host.querySelectorAll("*")) {
    for (const attr of el.attributes) {
      assert.ok(!/^on/i.test(attr.name), `${el.tagName} keeps ${attr.name}`);
      assert.ok(!["src", "srcset", "poster", "background", "style"].includes(attr.name), `${el.tagName} keeps ${attr.name}`);
    }
  }
  // The reader sees what the file says: raw HTML reads as text.
  assert.match(host.textContent, /<img src="https:\/\/example\.com\/x\.png">/);
  assert.match(host.textContent, /<script>alert\(1\)<\/script>/);
  assert.match(host.textContent, /<script>a<b<\/script>/, "raw-block inline text is escaped, not passed through");
  assert.match(host.textContent, /<p onerror="x\(\)">para<\/p>/);
  // Images read as their alt text; links still work.
  assert.match(host.textContent, /\ba and rel and ref\b/);
  assert.deepEqual([...host.querySelectorAll("a[data-open-file]")].map(a => a.getAttribute("data-open-file")), ["/skills/b/SKILL.md"]);
  const site = host.querySelector('a[href="https://example.com"]');
  assert.equal(site.getAttribute("rel"), "noreferrer noopener");
});

test("strict off keeps the viewer's raw-HTML behaviour", () => {
  const div = fragment(renderMarkdownHtml("<b>bold</b> ![a](https://e.com/y.png)", newDoc(), { path: "/a.md" }));
  assert.ok(div.querySelector("b"));
  assert.equal(div.querySelector("img").getAttribute("src"), "https://e.com/y.png");
});

test("strict keeps data-open-file links that localFiles:false would unwrap", () => {
  const src = "[x](y.md)";
  const strict = fragment(renderMarkdownHtml(src, newDoc(), { path: "/d/a.md", strict: true }));
  assert.equal(strict.querySelector("a[data-open-file]").getAttribute("data-open-file"), "/d/y.md");
  const picked = fragment(renderMarkdownHtml(src, newDoc(), { path: null, localFiles: false }));
  assert.equal(picked.querySelector("a"), null);
});

test("renderCodeHtml escapes HTML and highlights by extension", () => {
  const html = renderCodeHtml('<img src=x onerror="alert(1)"><script>x()</script>', "page.html");
  const div = fragment(html);
  assert.equal(div.querySelector("img"), null);
  assert.equal(div.querySelector("script"), null);
  const code = div.querySelector("pre.md-code > code.hljs");
  assert.equal(code.textContent, '<img src=x onerror="alert(1)"><script>x()</script>');
  assert.ok(code.querySelector(".hljs-tag"), "xml highlighting for .html");
  assert.ok(fragment(renderCodeHtml("def f(): pass", "a.PY")).querySelector(".hljs-keyword"), "extension is case-insensitive");
});

test("isMarkdownName", () => {
  for (const n of ["SKILL.md", "README.MD", "a.markdown", "b.mdown", "c.mkd", "dir/x.Md"]) assert.equal(isMarkdownName(n), true, n);
  for (const n of ["a.txt", "md", "a.mdx", "", null, undefined, "a.md.json"]) assert.equal(isMarkdownName(n), false, String(n));
});

test("decorateMarkdown: ids and copy buttons; anchors optional", () => {
  const html = renderMarkdownHtml("# Title\n\n## Title\n\n```\nx\n```\n", newDoc(), { path: "/a.md" });
  const doc = newDoc();
  const plain = doc.createElement("div");
  plain.innerHTML = html;
  decorateMarkdown(plain, doc, { anchors: false });
  assert.deepEqual([...plain.querySelectorAll("h1, h2")].map(h => h.id), ["title", "title-1"]);
  assert.equal(plain.querySelector(".hanchor"), null);
  assert.equal(plain.querySelectorAll("pre.md-code > button.md-copy").length, 1);
  assert.equal(plain.querySelector("h1").textContent, "Title");

  const anchored = doc.createElement("div");
  anchored.innerHTML = html;
  decorateMarkdown(anchored, doc);
  assert.equal(anchored.querySelectorAll(".hanchor").length, 2);
});

test("MARKDOWN_CSS is the viewer stylesheet", () => {
  assert.match(MARKDOWN_CSS, /\.mdv pre\.md-code/);
  assert.match(MARKDOWN_CSS, /\.mdv \.hanchor/);
});
