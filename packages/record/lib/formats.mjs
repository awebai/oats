// Session transcript formats the record knows how to capture.
//
// The storage contract is format-agnostic (verbatim blob + session turn);
// a format contributes only: where its transcripts live, how to name a
// session, and how to extract conversational text for the derived index.
// Every format's records carry a top-level `timestamp` string, so the
// last-timestamp/event-count scan in capture is shared.
//
// Extraction policy (corrected 2026-08-19, Juan): NEVER strip anything
// model-visible. An agent cannot be recovered if tool calls and their
// results are not part of the session, so extraction surfaces the full
// conversation: user/assistant text, thinking (where the harness persists
// it readably), tool calls with their inputs, tool results, attachments.
// Roles label every piece so consumers can filter; nothing is dropped.
// Harness bookkeeping the model never saw as conversation (file
// snapshots, queue operations, mode flips) yields no docs — but its
// native line is still stored verbatim in the turn, so nothing is lost.

import { lstatSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { nativeDirectory } from "./session-roots.mjs";

// Iterate JSONL lines of a buffer without materializing the whole file as
// one string — real transcripts reach hundreds of MB (a 789 MB Codex
// rollout exists on this machine), beyond V8's single-string limit. A line
// that itself exceeds the limit yields text:null (counted, not decoded).
export function* jsonlLines(bytes) {
  let start = 0;
  let lineNo = 0;
  while (start < bytes.length) {
    let nl = bytes.indexOf(10, start);
    if (nl === -1) nl = bytes.length;
    lineNo++;
    let text = null;
    try {
      text = bytes.toString("utf8", start, nl);
    } catch {
      // single line beyond the string limit: undecodable, still an event
    }
    yield { text, lineNo };
    start = nl + 1;
  }
}

function* parsedLines(bytes) {
  for (const { text, lineNo } of jsonlLines(bytes)) {
    if (text === null || text.trim() === "") continue;
    try {
      yield { d: JSON.parse(text), lineNo };
    } catch {
      /* unparseable line: preserved in the blob, nothing to extract */
    }
  }
}

function listJsonlFiles(root, maxDepth, { strict = false } = {}) {
  const out = [];
  const walk = (dir, depth) => {
    let names;
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      // An optional, absent root is normal; an unreadable directory or a
      // subtree that disappeared during discovery is not an empty scan.
      if (!strict && depth === 0 && err.code === "ENOENT") return;
      throw err;
    }
    for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.name.endsWith(".jsonl") && !entry.isDirectory()) {
        out.push(path); // privacy rules precede opening/statting source links
      } else if (entry.isDirectory() || (entry.isSymbolicLink() && statSync(path).isDirectory())) {
        if (depth < maxDepth) walk(path, depth + 1);
      }
    }
  };
  walk(root, 0);
  return out;
}

// Only absence makes a default root optional. existsSync also hides access
// failures, which would turn an unperformed scan into a false empty result.
function directoryExists(path) {
  try {
    if (!statSync(path).isDirectory()) throw new Error(`session root is not a directory: ${path}`);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") {
      // ENOENT through a dangling directory link is not an absent runtime.
      for (let part = path; ; part = dirname(part)) {
        try {
          if (lstatSync(part).isSymbolicLink()) throw new Error(`unresolvable session root: ${path}`);
          break;
        } catch (e) { if (e.code !== "ENOENT") throw e; }
        if (dirname(part) === part) break;
      }
      return false;
    }
    throw err;
  }
}

// ------------------------------------------------------------ claude code

function configuredRoot(value, suffix, options) {
  const root = join(nativeDirectory(value, options), suffix);
  // Explicitly relocated storage is not an optional absent default. A
  // missing/unreadable root means we cannot certify its evidence inventory.
  if (!directoryExists(root)) throw new Error(`configured session root does not exist: ${root}`);
  return [root];
}

function ccRoots(home = homedir(), env = process.env, options = {}) {
  if (env.CLAUDE_CONFIG_DIR) return configuredRoot(env.CLAUDE_CONFIG_DIR, "projects", { home, ...options });
  const roots = [];
  for (const entry of readdirSync(home, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.name.startsWith(".claude")) continue;
    // ~/.claude.json and its backups are normal config FILES, not roots.
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.isSymbolicLink() && !statSync(join(home, entry.name)).isDirectory()) continue;
    const projects = join(home, entry.name, "projects");
    if (directoryExists(projects)) roots.push(projects);
  }
  return roots;
}

// Native Claude child transcripts live at
// projects/<project>/<sessionId>/subagents/agent-*.jsonl, not beside the
// parent's file. Enumerate only this layout, never arbitrary project files.
function listCcFiles(root, { strict = false } = {}) {
  const out = [];
  const entries = (dir, optional = false) => {
    try { return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
    catch (err) { if (optional && err.code === "ENOENT") return []; throw err; }
  };
  const directory = (entry, path) => entry.isDirectory() || (entry.isSymbolicLink() && !entry.name.endsWith(".jsonl") && statSync(path).isDirectory());
  for (const project of entries(root, !strict)) {
    const projectPath = join(root, project.name);
    if (!directory(project, projectPath)) {
      if (project.name.endsWith(".jsonl")) out.push(projectPath);
      continue;
    }
    for (const entry of entries(projectPath)) {
      const path = join(projectPath, entry.name);
      if (!directory(entry, path)) {
        if (entry.name.endsWith(".jsonl")) out.push(path);
        continue;
      }
      // Listing the session directory (rather than treating ENOENT at an
      // assumed subagents path as optional) preserves disappearance errors.
      for (const childDir of entries(path)) {
        if (childDir.name !== "subagents") continue;
        const children = join(path, childDir.name);
        if (!directory(childDir, children)) throw new Error(`session subagents root is not a directory: ${children}`);
        for (const child of entries(children)) {
          if (child.name.endsWith(".jsonl")) out.push(join(children, child.name));
        }
      }
    }
  }
  return out;
}

function ccParentId(path) {
  return basename(dirname(path)) === "subagents" ? basename(dirname(dirname(path))) : null;
}
function ccSessionId(path) {
  const parent = ccParentId(path), id = basename(path, ".jsonl");
  return parent ? `${parent}.${id}` : id;
}

// Cap for the unknown-part fallback: prefix stays searchable, the full
// bytes are always in the verbatim blob — this bounds the index, it does
// not strip the record.
const FALLBACK_CAP = 2000;

function binaryPlaceholder(part) {
  // Base64-payload parts (documents, images) are not searchable text;
  // index a descriptive placeholder, the blob keeps the bytes.
  const src = part.source;
  if (src && typeof src.data === "string" && src.data.length > 256) {
    const media = src.media_type ?? src.mediaType ?? "binary";
    return `[${part.type}: ${media}, ${src.data.length} base64 chars; full content in session blob]`;
  }
  return null;
}

function pushPart(docs, lineNo, baseRole, part, ts = "") {
  if (typeof part !== "object" || part === null) return;
  if (part.type === "text" && typeof part.text === "string") {
    if (part.text.trim()) docs.push({ loc: `line:${lineNo}`, role: baseRole, text: part.text, ts });
  } else if (part.type === "thinking") {
    const t = typeof part.thinking === "string" ? part.thinking : "";
    if (t.trim()) docs.push({ loc: `line:${lineNo}`, role: "thinking", text: t, ts });
  } else if (part.type === "tool_use" || part.type === "toolCall") {
    // pi spells it toolCall with pre-encoded string arguments; cc spells it
    // tool_use with an input object. One normalized role either way.
    const args =
      typeof part.arguments === "string" ? part.arguments : safeJson(part.input ?? part.arguments);
    docs.push({ loc: `line:${lineNo}`, role: "tool_use", text: `${part.name ?? "tool"} ${args}`, ts });
  } else if (part.type === "tool_result") {
    const c = part.content;
    const text =
      typeof c === "string"
        ? c
        : Array.isArray(c)
          ? c.map((p) => (typeof p?.text === "string" ? p.text : safeJson(p))).join("\n")
          : safeJson(c);
    if (String(text).trim()) docs.push({ loc: `line:${lineNo}`, role: "tool_result", text: String(text), ts });
  } else if (typeof part.text === "string" && part.text.trim()) {
    docs.push({ loc: `line:${lineNo}`, role: baseRole, text: part.text, ts });
  } else {
    // Unknown model-visible part: keep it, but bounded — binary payloads
    // become descriptive placeholders, anything else is capped with the
    // full bytes always in the blob.
    const placeholder = binaryPlaceholder(part);
    if (placeholder) {
      docs.push({ loc: `line:${lineNo}`, role: part.type ?? baseRole, text: placeholder, ts });
      return;
    }
    let text = safeJson(part);
    if (text.length > FALLBACK_CAP) {
      text = text.slice(0, FALLBACK_CAP) + ` [+${text.length - FALLBACK_CAP} chars; full content in session blob]`;
    }
    docs.push({ loc: `line:${lineNo}`, role: part.type ?? baseRole, text, ts });
  }
}

function safeJson(v) {
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return String(v);
  }
}

export function extractCcText(bytes) {
  const docs = [];
  for (const { d, lineNo } of parsedLines(bytes)) {
    const ts = typeof d.timestamp === "string" ? d.timestamp : "";
    if (d.type === "user" || d.type === "assistant") {
      const content = d.message?.content;
      if (typeof content === "string") {
        if (content.trim()) docs.push({ loc: `line:${lineNo}`, role: d.type, text: content, ts });
      } else if (Array.isArray(content)) {
        for (const part of content) pushPart(docs, lineNo, d.type, part, ts);
      }
    } else if (d.type === "attachment") {
      const text = safeJson(d.attachment);
      if (text && text !== "null") docs.push({ loc: `line:${lineNo}`, role: "attachment", text, ts });
    } else if (d.type === "system") {
      const text = typeof d.content === "string" ? d.content : safeJson(d.content);
      if (String(text).trim()) docs.push({ loc: `line:${lineNo}`, role: "system", text: String(text), ts });
    }
    // Everything else (mode, file-history-*, queue-operation, ...) is
    // harness bookkeeping: not conversation, preserved verbatim in the blob.
  }
  return docs;
}

// --------------------------------------------------------------------- pi

function piRoots(home = homedir(), env = process.env, options = {}) {
  if (env.PI_CODING_AGENT_SESSION_DIR) return configuredRoot(env.PI_CODING_AGENT_SESSION_DIR, "", { home, ...options, tilde: true });
  if (env.PI_CODING_AGENT_DIR) return configuredRoot(env.PI_CODING_AGENT_DIR, "sessions", { home, ...options, tilde: true });
  const root = join(home, ".pi", "agent", "sessions");
  return directoryExists(root) ? [root] : [];
}

export function extractPiText(bytes) {
  const docs = [];
  for (const { d, lineNo } of parsedLines(bytes)) {
    const ts = typeof d.timestamp === "string" ? d.timestamp : "";
    if (d.type === "message") {
      const rawRole = d.message?.role;
      const role = rawRole === "toolResult" ? "tool_result" : rawRole;
      if (!role) continue;
      const content = d.message?.content;
      if (typeof content === "string") {
        if (content.trim()) docs.push({ loc: `line:${lineNo}`, role, text: content, ts });
      } else if (Array.isArray(content)) {
        for (const part of content) pushPart(docs, lineNo, role, part, ts);
      }
    } else if (d.type === "custom_message") {
      const text = typeof d.content === "string" ? d.content : safeJson(d.content ?? d);
      if (String(text).trim()) docs.push({ loc: `line:${lineNo}`, role: "system", text: String(text), ts });
    }
  }
  return docs;
}

// pi filenames: <iso-ts>_<uuid>.jsonl — the uuid is the session id.
function piSessionId(path) {
  const stem = basename(path, ".jsonl");
  const i = stem.lastIndexOf("_");
  return i >= 0 ? stem.slice(i + 1) : stem;
}

// ------------------------------------------------------------------ codex

function codexRoots(home = homedir(), env = process.env, options = {}) {
  if (env.CODEX_HOME) return configuredRoot(env.CODEX_HOME, "sessions", { home, ...options });
  const root = join(home, ".codex", "sessions");
  return directoryExists(root) ? [root] : [];
}

export function extractCodexText(bytes) {
  const docs = [];
  for (const { d, lineNo } of parsedLines(bytes)) {
    if (d.type !== "response_item") continue;
    const p = d.payload;
    if (!p || typeof p !== "object") continue;
    const ts = typeof d.timestamp === "string" ? d.timestamp : "";
    if (p.type === "message" && (p.role === "user" || p.role === "assistant")) {
      const text = Array.isArray(p.content)
        ? p.content
            .filter((x) => typeof x?.text === "string")
            .map((x) => x.text)
            .join("\n")
        : "";
      if (text.trim()) docs.push({ loc: `line:${lineNo}`, role: p.role, text, ts });
    } else if (p.type === "reasoning") {
      const text = Array.isArray(p.summary)
        ? p.summary.map((x) => (typeof x?.text === "string" ? x.text : "")).join("\n")
        : "";
      if (text.trim()) docs.push({ loc: `line:${lineNo}`, role: "thinking", text, ts });
    } else if (p.type === "function_call" || p.type === "custom_tool_call") {
      const text = `${p.name ?? "tool"} ${typeof p.arguments === "string" ? p.arguments : safeJson(p.arguments ?? p.input)}`;
      docs.push({ loc: `line:${lineNo}`, role: "tool_use", text, ts });
    } else if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
      const out = p.output;
      const text = typeof out === "string" ? out : safeJson(out);
      if (String(text).trim()) docs.push({ loc: `line:${lineNo}`, role: "tool_result", text: String(text), ts });
    }
    // ghost_snapshot and other non-conversation payloads: no docs; the
    // native line survives verbatim in the turn body regardless.
  }
  return docs;
}

// codex filenames: rollout-<ts>-<uuid>.jsonl — trailing uuid is the id.
function codexSessionId(path) {
  const stem = basename(path, ".jsonl");
  const tail = stem.slice(-36);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(tail)
    ? tail
    : stem;
}

// --------------------------------------------------------------- registry

export const SESSION_FORMATS = {
  cc: {
    source: "cc",
    defaultRoots: ccRoots,
    listFiles: (roots, options) => roots.flatMap((r) => listCcFiles(r, options)),
    sessionId: ccSessionId,
    ignoreKeys: (path) => [basename(path, ".jsonl"), ccParentId(path)].filter(Boolean),
    extractText: extractCcText,
  },
  pi: {
    source: "pi",
    defaultRoots: piRoots,
    listFiles: (roots, options) => roots.flatMap((r) => listJsonlFiles(r, 1, options)),
    sessionId: piSessionId,
    extractText: extractPiText,
  },
  codex: {
    source: "codex",
    defaultRoots: codexRoots,
    listFiles: (roots, options) => roots.flatMap((r) => listJsonlFiles(r, 3, options)),
    sessionId: codexSessionId,
    extractText: extractCodexText,
  },
};

// Text extraction for an already-captured session turn, by its provenance
// source. Unknown sources index nothing (the blob remains recallable).
export function extractSessionTextFor(source, bytes) {
  const format = SESSION_FORMATS[source];
  return format ? format.extractText(bytes) : [];
}
