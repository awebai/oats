/**
 * Markdown viewer — desktop-app view contract: mount(el, ctx) / unmount().
 *
 * ctx = { api(pathname, opts), openFile(path), openTerminal(instance),
 *         path: "<abs path of the file to open>",
 *         pickedFile?: File, owns?: () => boolean }
 * A pickedFile takes precedence over path and stays entirely in the renderer.
 * Pass the chooser's owns predicate (plus tab lifetime) to guard pending reads.
 *
 * Renders a proper reader for markdown files (headings, lists, tables, fenced
 * code with syntax highlighting, blockquotes). Relative links to other .md
 * files re-open through ctx.openFile; plain non-markdown text files render
 * read-only with syntax highlighting (same view, cheap win).
 *
 * Data source: pickedFile.text(), or legacy GET /api/file?path=<abs> via ctx.api.
 * Browser picks have no absolute path: only basename/read-only provenance is
 * shown, and local file navigation is unavailable rather than guessed.
 *
 * The render pipeline is exported (renderMarkdownHtml, renderCodeHtml,
 * isMarkdownName, decorateMarkdown, MARKDOWN_CSS) and shared with the
 * capability page's Contents reader: one sanitiser, never a second copy.
 */
import { Marked } from "marked";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import { escapeHtml } from "./common.mjs";

// Mirrors server/oats-web.mjs's fileData contract; pinned by renderer tests.
export const FILE_MAX_BYTES = 2 * 1024 * 1024;
const MARKDOWN_EXT = new Set(["md", "markdown", "mdown", "mkd"]);
const extOf = (name) => (String(name ?? "").split(".").pop() || "").toLowerCase();
/** True for a Markdown file name (extension, case-insensitive). */
export function isMarkdownName(name) {
  const s = String(name ?? "");
  return s.includes(".") && MARKDOWN_EXT.has(extOf(s));
}

export async function readPickedFile(pickedFile) {
  const { name, size } = pickedFile; // deliberately never inspect .path/.webkitRelativePath
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("File size is unavailable.");
  if (size > FILE_MAX_BYTES) throw new Error("File too large (maximum 2 MiB).");
  let content;
  try { content = await pickedFile.text(); }
  catch { throw new Error("The selected file could not be read. Please choose it again."); }
  // File is immutable in browsers. Also check the result for synthetic/adapted
  // sources, and count UTF-8 bytes, not JavaScript string length.
  if (typeof content !== "string") throw new Error("The selected file is not text.");
  if (new TextEncoder().encode(content).byteLength > FILE_MAX_BYTES) throw new Error("File too large (maximum 2 MiB).");
  if (content.includes("\u0000")) throw new Error("Binary files cannot be displayed as text (NUL byte found).");
  return { name, size, content, markdown: MARKDOWN_EXT.has(extOf(name)) };
}

const EXT_LANG = {
  mjs: "javascript", cjs: "javascript", js: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", py: "python", rb: "ruby", sh: "bash",
  bash: "bash", zsh: "bash", yml: "yaml", yaml: "yaml", json: "json",
  html: "xml", xml: "xml", css: "css", scss: "scss", go: "go", rs: "rust",
  java: "java", c: "c", h: "c", cpp: "cpp", hpp: "cpp", sql: "sql",
  toml: "ini", ini: "ini", diff: "diff", patch: "diff",
};

export function highlight(code, lang) {
  try {
    if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
    return hljs.highlightAuto(code).value;
  } catch { return escapeHtml(code); }
}
// One escaper for content and quoted attributes (quotes included).
export { escapeHtml };

/** Resolve a relative markdown link against the open file's directory. */
export function resolveRelative(fromPath, href) {
  const base = fromPath.split("/").slice(0, -1);
  const parts = href.split("/");
  const out = [...base];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return "/" + out.filter(Boolean).join("/");
}

const SAFE_EXTERNAL = new Set(["http:", "https:", "mailto:"]);
const isExternal = (href) => /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
/** Active schemes (javascript:, data:, vbscript:, …) are NOT links we honor. */
export function externalHref(href) {
  try { return SAFE_EXTERNAL.has(new URL(href, "https://x.invalid").protocol) ? href : null; }
  catch { return null; }
}

/** SECURITY: repository markdown is untrusted — marked preserves raw HTML, so
 * everything we insert goes through DOMPurify, then EVERY surviving anchor is
 * normalized: data-open-file links become local (href="#", no target); all
 * other links must pass the external-scheme allowlist and are forced to
 * target="_blank" rel="noreferrer noopener" — raw-HTML anchors cannot keep
 * attacker-chosen target/rel (renderer navigation, tabnabbing).
 * strict: the no-resource profile of localFiles:false, but data-open-file
 * links stay local links (the capability Contents reader opens them). */
export function sanitizeHtml(html, doc, { localFiles = true, strict = false } = {}) {
  const purify = typeof DOMPurify === "function" ? DOMPurify(doc.defaultView) : DOMPurify;
  const lockdown = strict || !localFiles;
  const frag = purify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ADD_ATTR: ["data-open-file"],
    FORBID_TAGS: ["style", "form", "input", "button", ...(lockdown
      ? ["img", "picture", "video", "audio", "source", "track", "iframe", "object", "embed", "link", "svg", "math",
        "textarea", "select", "option", "optgroup", "datalist"] : [])],
    // A private picked document must not initiate resource requests (including
    // CSS URLs). External links remain explicit, sanitized user actions.
    FORBID_ATTR: lockdown ? ["style", "src", "srcset", "poster", "background", "contenteditable", "autofocus"] : [],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):|^#/i,
  });
  for (const a of frag.querySelectorAll("a")) {
    if (a.hasAttribute("data-open-file")) {
      // Raw HTML can forge this attribute too; lack of a path is not authority
      // to fetch arbitrary files from the current workspace or filesystem /.
      if (!localFiles) { a.replaceWith(...a.childNodes); continue; }
      a.setAttribute("href", "#");
      a.removeAttribute("target");
      a.removeAttribute("rel");
      continue;
    }
    const href = a.getAttribute("href") || "";
    // plain fragment links are local/neutral — never external, never _blank
    if (href.startsWith("#")) { a.removeAttribute("target"); a.removeAttribute("rel"); continue; }
    const safe = externalHref(href);
    if (!safe) { // unsafe/relative raw-HTML anchor: neutralize to plain text
      a.replaceWith(...a.childNodes);
      continue;
    }
    a.setAttribute("href", safe);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noreferrer noopener");
  }
  const div = doc.createElement("div");
  div.append(frag);
  return div.innerHTML;
}

/* rootedLinks:false is for readers whose paths are relative to some root (the
   capability Contents reader): an absolute filesystem path means nothing there,
   so it renders as its plain label instead of a local link.
   strict (untrusted repository text): raw HTML renders as escaped text (a
   block as a code block, so the reader sees what the file says) and images
   as their alt text. Text inside an inline <script>/<pre> is escaped too:
   marked marks it pre-escaped (raw) at lex time. */
function makeMarked(filePath, { rootedLinks = true, strict = false } = {}) {
  const marked = new Marked({
    gfm: true,
    ...(strict ? { walkTokens(token) { if (token.type === "text" && token.escaped) token.escaped = false; } } : {}),
    renderer: {
      ...(strict ? {
        html: ({ text, block }) => block
          ? `<pre class="md-code"><code>${escapeHtml(text.replace(/\n+$/, ""))}</code></pre>\n`
          : escapeHtml(text),
        image: ({ text }) => escapeHtml(text || ""),
      } : {}),
      code({ text, lang }) {
        const l = (lang || "").split(/\s+/)[0];
        return `<pre class="md-code"><code class="hljs">${highlight(text, l)}</code></pre>`;
      },
      link({ href, title, tokens }) {
        const label = this.parser.parseInline(tokens);
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        if (isExternal(href)) {
          const safe = externalHref(href);
          // active/unknown schemes (javascript:, data:) render as plain text
          if (!safe) return label;
          return `<a href="${escapeHtml(safe)}"${t} target="_blank" rel="noreferrer noopener">${label}</a>`;
        }
        // relative link: strip fragment, resolve against the open file's dir,
        // and route through ctx.openFile (wired via a delegated click handler)
        const clean = href.split("#")[0];
        if (!clean) return `<a href="${escapeHtml(href)}"${t}>${label}</a>`;
        if (!filePath) return label; // browser pick: local links are plain text
        if (!rootedLinks && clean.startsWith("/")) return label;
        const abs = clean.startsWith("/") ? clean : resolveRelative(filePath, clean);
        return `<a href="#" data-open-file="${escapeHtml(abs)}"${t}>${label}</a>`;
      },
    },
  });
  return marked;
}

/** Sanitized HTML for a Markdown source, exactly as the viewer renders it.
 * path: the file's path, which relative links resolve against (null: local
 * links render as plain text); localFiles: see sanitizeHtml; strict: no raw
 * HTML, no images, no resource-loading attributes (untrusted content). */
export function renderMarkdownHtml(source, doc, { path = null, localFiles = true, rootedLinks = true, strict = false } = {}) {
  return sanitizeHtml(makeMarked(path, { rootedLinks, strict }).parse(String(source ?? "")), doc, { localFiles, strict });
}

/** Read-only highlighted block for a non-Markdown file, language by extension. */
export function renderCodeHtml(text, fileName) {
  const lang = EXT_LANG[extOf(fileName)];
  return `<pre class="md-code"><code class="hljs">${highlight(String(text ?? ""), lang)}</code></pre>`;
}

export const MARKDOWN_CSS = `
.mdv-scroll { height: 100%; overflow-y: auto; background: var(--bg); color: var(--fg); }
.mdv { max-width: 860px; margin: 0 auto; padding: 28px 36px 72px; font: 15px/1.7 -apple-system, "Segoe UI", sans-serif; }
.mdv h1 { font-size: 1.7em; margin: 1.2em 0 .6em; }
.mdv h2 { font-size: 1.35em; margin: 1.4em 0 .5em; }
.mdv h3 { font-size: 1.12em; margin: 1.3em 0 .4em; }
.mdv h1:first-child { margin-top: 0; }
.mdv h1, .mdv h2 { border-bottom: 1px solid var(--md-rule); padding-bottom: .3em; }
.mdv h1, .mdv h2, .mdv h3, .mdv h4 { position: relative; scroll-margin-top: 16px; }
.mdv .hanchor { position: absolute; left: -22px; top: 0; color: var(--accent);
                text-decoration: none; font-weight: 400; }
.mdv a { color: var(--accent); }
.mdv pre.md-code { position: relative; padding: 36px 15px 13px; border-radius: 8px; overflow-x: auto;
                   background: var(--md-code-bg); border: 1px solid var(--md-rule); }
.mdv pre.md-code .md-copy { position: absolute; top: 6px; right: 6px; border: 1px solid var(--border);
                            background: var(--surface); color: var(--muted); border-radius: 6px;
                            font: 11px -apple-system, sans-serif; padding: 3px 9px; cursor: pointer; }
.mdv pre.md-code .md-copy:hover { color: var(--fg); border-color: var(--accent); }
.mdv code { font: 13px/1.55 "SF Mono", ui-monospace, Menlo, monospace; }
/* Shared by fenced Markdown and read-only code files. Semantic foregrounds
   stay opaque; theme-contrast tests validate the composited md-code-bg. */
.mdv .hljs { color: var(--fg); }
.mdv .hljs-comment, .mdv .hljs-quote { color: var(--muted); }
.mdv .hljs-keyword, .mdv .hljs-selector-tag, .mdv .hljs-doctag,
.mdv .hljs-meta, .mdv .hljs-meta .hljs-keyword { color: var(--violet); }
.mdv .hljs-title, .mdv .hljs-section, .mdv .hljs-name, .mdv .hljs-attr,
.mdv .hljs-attribute, .mdv .hljs-selector-id, .mdv .hljs-selector-class,
.mdv .hljs-selector-attr, .mdv .hljs-selector-pseudo, .mdv .hljs-link { color: var(--accent); }
.mdv .hljs-string, .mdv .hljs-regexp, .mdv .hljs-addition,
.mdv .hljs-meta .hljs-string { color: var(--ok); }
.mdv .hljs-number, .mdv .hljs-literal, .mdv .hljs-type, .mdv .hljs-built_in,
.mdv .hljs-symbol, .mdv .hljs-bullet, .mdv .hljs-variable,
.mdv .hljs-template-variable, .mdv .hljs-deletion { color: var(--warn); }
.mdv .hljs-subst, .mdv .hljs-params, .mdv .hljs-property,
.mdv .hljs-punctuation, .mdv .hljs-operator, .mdv .hljs-tag,
.mdv .hljs-template-tag, .mdv .hljs-code { color: var(--fg); }
.mdv .hljs-emphasis { font-style: italic; }
.mdv .hljs-strong { font-weight: 700; }
.mdv :not(pre) > code { background: var(--md-code-bg); padding: .15em .4em; border-radius: 4px; }
.mdv table { border-collapse: collapse; display: block; overflow-x: auto; }
.mdv th, .mdv td { border: 1px solid var(--md-rule); padding: 5px 12px; }
.mdv th { background: var(--md-code-bg); }
.mdv blockquote { margin: 0; padding: 2px 1em; border-left: 3px solid var(--accent); color: var(--muted); }
.mdv img { max-width: 100%; border-radius: 6px; }
.mdv hr { border: none; border-top: 1px solid var(--md-rule); margin: 24px 0; }
.mdv li + li { margin-top: .18em; }
.mdv .mdv-meta { font: 12px "SF Mono", ui-monospace, monospace; color: var(--muted); margin-bottom: 18px;
                 display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.mdv .mdv-meta .crumb { word-break: break-all; }
.mdv .mdv-error { color: var(--danger); }
.mdv .mdv-loading { display: flex; align-items: center; gap: 10px; color: var(--muted);
                    font: 13px -apple-system, sans-serif; padding: 48px 0; justify-content: center; }
@keyframes mdv-spin { to { transform: rotate(360deg); } }
.mdv .mdv-spinner { width: 14px; height: 14px; border: 2px solid var(--md-rule);
                    border-top-color: var(--accent); border-radius: 50%;
                    animation: mdv-spin .7s linear infinite; }
`;

/* Per-mount state: the shell opens several markdown tabs at once, so each
   mount owns its own nodes and returns its disposer (the view host prefers
   it). The exported unmount() disposes ALL active mounts — kept for the
   original module-contract callers (harness). */
const mounts = new Set();

export async function mount(el, ctx) {
  const doc0 = el.ownerDocument;
  const scroll = doc0.createElement("div");
  scroll.className = "mdv-scroll";
  const root = doc0.createElement("div");
  root.className = "mdv";
  scroll.append(root);
  const style = doc0.createElement("style");
  style.textContent = MARKDOWN_CSS;
  el.append(style, scroll);
  const picked = ctx.pickedFile != null;
  const alive = () => mounts.has(dispose);
  const owns = () => alive() && (ctx.owns?.() ?? true);
  const timers = new Set();

  const onClick = (e) => {
    if (!alive()) return;
    const a = e.target.closest?.("a[data-open-file]");
    if (a) {
      e.preventDefault();
      if (!picked) ctx.openFile(a.getAttribute("data-open-file"));
      return;
    }
    // heading anchors + in-document fragment links scroll locally
    const frag = e.target.closest?.('a[href^="#"]');
    if (frag) {
      e.preventDefault();
      let id;
      try { id = decodeURIComponent(frag.getAttribute("href").slice(1)); } catch { return; }
      [...scroll.querySelectorAll("[id]")].find(node => node.id === id)?.scrollIntoView?.({ block: "start" });
      return;
    }
    const copy = e.target.closest?.(".md-copy");
    if (copy) copyCodeBlock(copy, doc0, { alive, timers });
  };
  scroll.addEventListener("click", onClick);
  const dispose = () => {
    if (!mounts.has(dispose)) return;
    mounts.delete(dispose);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    scroll.removeEventListener("click", onClick);
    scroll.remove();
    style.remove();
  };
  mounts.add(dispose);

  if (!owns()) { dispose(); return dispose; }
  const path = picked ? null : ctx.path;
  const label = picked ? ctx.pickedFile.name : path || "(no path)";
  root.innerHTML = `<div class="mdv-loading"><span class="mdv-spinner"></span> Loading ${escapeHtml(picked ? label : String(path || "").split("/").pop())}…</div>`;
  let file;
  try {
    if (picked) file = await readPickedFile(ctx.pickedFile);
    else {
      const res = await ctx.api(`/api/file?path=${encodeURIComponent(path)}`);
      if (!owns()) return dispose;
      file = res && res.json ? await res.json() : res; // Response or parsed JSON
      if (file.error) throw new Error(file.error);
    }
  } catch (e) {
    if (!owns()) return dispose;
    root.innerHTML = `<div class="mdv-error">Could not open ${escapeHtml(label)}: ${escapeHtml(e.message || String(e))}</div>`;
    return dispose;
  }
  if (!owns()) return dispose;   // closed/superseded while the file loaded
  const kb = file.size >= 10240 ? `${(file.size / 1024).toFixed(1)} KB` : `${file.size} B`;
  const provenance = picked ? "<span>Read-only · browser-selected file</span><span>Full path unavailable; local file links and embedded resources are disabled.</span>" : "";
  const meta = `<div class="mdv-meta"><span class="crumb">${escapeHtml(picked ? file.name : file.path)}</span><span>${kb}</span>${provenance}</div>`;
  const doc = el.ownerDocument;
  if (file.markdown) {
    root.innerHTML = meta + renderMarkdownHtml(file.content, doc, { path: picked ? null : file.path, localFiles: !picked });
  } else {
    // plain/code file: read-only highlighted view
    root.innerHTML = meta + renderCodeHtml(file.content, file.name);
  }
  decorateMarkdown(root, doc);
  return dispose;
}

/** A code block's copy button (decorateMarkdown adds it): its code to the clipboard, "copied" for a moment, or
 * "copy failed". Clipboard copying is explicit and read-only; never a terminal send. `alive`: the owner is still
 * mounted; `timers`: the owner's Set, cleared when it disposes. Shared with the capability Contents reader. */
export function copyCodeBlock(button, doc, { alive = () => true, timers = new Set() } = {}) {
  const code = button.parentElement?.querySelector("code")?.textContent || "";
  try {
    const writing = doc.defaultView.navigator.clipboard?.writeText(code);
    if (!writing) { button.textContent = "copy failed"; return; }
    Promise.resolve(writing).then(() => {
      if (!alive()) return;
      button.textContent = "copied";
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (alive()) button.textContent = "copy";
      }, 1200);
      timers.add(timer);
    }).catch(() => { if (alive()) button.textContent = "copy failed"; });
  } catch { if (alive()) button.textContent = "copy failed"; }
}

/* Heading ids as one document numbers them: a heading's text slugged, a repeat
   taking the next "-<n>". One slugger per document. */
export function createHeadingSlugger() {
  const seen = new Map();
  return text => {
    const slugBase = text.trim().toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "") || "section";
    const n = seen.get(slugBase) || 0;
    seen.set(slugBase, n + 1);
    return n ? `${slugBase}-${n}` : slugBase;
  };
}

/* Post-render decoration (plain DOM, after sanitize): slugged heading ids +
   hover anchors (anchors:false skips the "#" links), and a copy button on
   every fenced block. */
export function decorateMarkdown(root, doc, { anchors = true } = {}) {
  const slugOf = createHeadingSlugger();
  for (const h of root.querySelectorAll("h1, h2, h3, h4")) {
    const slug = slugOf(h.textContent);
    h.id = slug;
    if (!anchors) continue;
    const a = doc.createElement("a");
    a.className = "hanchor";
    a.href = `#${slug}`;
    a.textContent = "#";
    a.setAttribute("aria-label", `Link to “${h.textContent.trim()}”`);
    h.prepend(a);
  }
  for (const pre of root.querySelectorAll("pre.md-code")) {
    const b = doc.createElement("button");
    b.className = "md-copy";
    b.type = "button";
    b.textContent = "copy";
    b.setAttribute("aria-label", "Copy code block");
    pre.append(b);
  }
}

export function unmount() {
  for (const d of [...mounts]) d();
}
