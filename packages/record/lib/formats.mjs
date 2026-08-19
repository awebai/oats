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
// Only harness bookkeeping the model never saw as conversation (file
// snapshots, queue operations, mode flips) stays blob-only — and the blob
// itself is always verbatim-complete regardless.

import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";

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

function listJsonlFiles(root, maxDepth) {
  const out = [];
  const walk = (dir, depth) => {
    let names;
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) walk(path, depth + 1);
      } else if (entry.name.endsWith(".jsonl")) {
        out.push(path);
      }
    }
  };
  walk(root, 0);
  return out;
}

// ------------------------------------------------------------ claude code

function ccRoots(home = homedir()) {
  const roots = [];
  for (const name of readdirSync(home).sort()) {
    if (!name.startsWith(".claude")) continue;
    const projects = join(home, name, "projects");
    if (existsSync(projects)) roots.push(projects);
  }
  return roots;
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

function pushPart(docs, lineNo, baseRole, part) {
  if (typeof part !== "object" || part === null) return;
  if (part.type === "text" && typeof part.text === "string") {
    if (part.text.trim()) docs.push({ loc: `line:${lineNo}`, role: baseRole, text: part.text });
  } else if (part.type === "thinking") {
    const t = typeof part.thinking === "string" ? part.thinking : "";
    if (t.trim()) docs.push({ loc: `line:${lineNo}`, role: "thinking", text: t });
  } else if (part.type === "tool_use" || part.type === "toolCall") {
    // pi spells it toolCall with pre-encoded string arguments; cc spells it
    // tool_use with an input object. One normalized role either way.
    const args =
      typeof part.arguments === "string" ? part.arguments : safeJson(part.input ?? part.arguments);
    docs.push({ loc: `line:${lineNo}`, role: "tool_use", text: `${part.name ?? "tool"} ${args}` });
  } else if (part.type === "tool_result") {
    const c = part.content;
    const text =
      typeof c === "string"
        ? c
        : Array.isArray(c)
          ? c.map((p) => (typeof p?.text === "string" ? p.text : safeJson(p))).join("\n")
          : safeJson(c);
    if (String(text).trim()) docs.push({ loc: `line:${lineNo}`, role: "tool_result", text: String(text) });
  } else if (typeof part.text === "string" && part.text.trim()) {
    docs.push({ loc: `line:${lineNo}`, role: baseRole, text: part.text });
  } else {
    // Unknown model-visible part: keep it, but bounded — binary payloads
    // become descriptive placeholders, anything else is capped with the
    // full bytes always in the blob.
    const placeholder = binaryPlaceholder(part);
    if (placeholder) {
      docs.push({ loc: `line:${lineNo}`, role: part.type ?? baseRole, text: placeholder });
      return;
    }
    let text = safeJson(part);
    if (text.length > FALLBACK_CAP) {
      text = text.slice(0, FALLBACK_CAP) + ` [+${text.length - FALLBACK_CAP} chars; full content in session blob]`;
    }
    docs.push({ loc: `line:${lineNo}`, role: part.type ?? baseRole, text });
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
    if (d.type === "user" || d.type === "assistant") {
      const content = d.message?.content;
      if (typeof content === "string") {
        if (content.trim()) docs.push({ loc: `line:${lineNo}`, role: d.type, text: content });
      } else if (Array.isArray(content)) {
        for (const part of content) pushPart(docs, lineNo, d.type, part);
      }
    } else if (d.type === "attachment") {
      const text = safeJson(d.attachment);
      if (text && text !== "null") docs.push({ loc: `line:${lineNo}`, role: "attachment", text });
    } else if (d.type === "system") {
      const text = typeof d.content === "string" ? d.content : safeJson(d.content);
      if (String(text).trim()) docs.push({ loc: `line:${lineNo}`, role: "system", text: String(text) });
    }
    // Everything else (mode, file-history-*, queue-operation, ...) is
    // harness bookkeeping: not conversation, preserved verbatim in the blob.
  }
  return docs;
}

// --------------------------------------------------------------------- pi

function piRoots(home = homedir()) {
  const root = join(home, ".pi", "agent", "sessions");
  return existsSync(root) ? [root] : [];
}

export function extractPiText(bytes) {
  const docs = [];
  for (const { d, lineNo } of parsedLines(bytes)) {
    if (d.type === "message") {
      const rawRole = d.message?.role;
      const role = rawRole === "toolResult" ? "tool_result" : rawRole;
      if (!role) continue;
      const content = d.message?.content;
      if (typeof content === "string") {
        if (content.trim()) docs.push({ loc: `line:${lineNo}`, role, text: content });
      } else if (Array.isArray(content)) {
        for (const part of content) pushPart(docs, lineNo, role, part);
      }
    } else if (d.type === "custom_message") {
      const text = typeof d.content === "string" ? d.content : safeJson(d.content ?? d);
      if (String(text).trim()) docs.push({ loc: `line:${lineNo}`, role: "system", text: String(text) });
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

function codexRoots(home = homedir()) {
  const root = join(home, ".codex", "sessions");
  return existsSync(root) ? [root] : [];
}

export function extractCodexText(bytes) {
  const docs = [];
  for (const { d, lineNo } of parsedLines(bytes)) {
    if (d.type !== "response_item") continue;
    const p = d.payload;
    if (!p || typeof p !== "object") continue;
    if (p.type === "message" && (p.role === "user" || p.role === "assistant")) {
      const text = Array.isArray(p.content)
        ? p.content
            .filter((x) => typeof x?.text === "string")
            .map((x) => x.text)
            .join("\n")
        : "";
      if (text.trim()) docs.push({ loc: `line:${lineNo}`, role: p.role, text });
    } else if (p.type === "reasoning") {
      const text = Array.isArray(p.summary)
        ? p.summary.map((x) => (typeof x?.text === "string" ? x.text : "")).join("\n")
        : "";
      if (text.trim()) docs.push({ loc: `line:${lineNo}`, role: "thinking", text });
    } else if (p.type === "function_call" || p.type === "custom_tool_call") {
      const text = `${p.name ?? "tool"} ${typeof p.arguments === "string" ? p.arguments : safeJson(p.arguments ?? p.input)}`;
      docs.push({ loc: `line:${lineNo}`, role: "tool_use", text });
    } else if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
      const out = p.output;
      const text = typeof out === "string" ? out : safeJson(out);
      if (String(text).trim()) docs.push({ loc: `line:${lineNo}`, role: "tool_result", text: String(text) });
    }
    // ghost_snapshot and other non-conversation payloads: blob-only.
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
    listFiles: (roots) => roots.flatMap((r) => listJsonlFiles(r, 1)),
    sessionId: (path) => basename(path, ".jsonl"),
    extractText: extractCcText,
  },
  pi: {
    source: "pi",
    defaultRoots: piRoots,
    listFiles: (roots) => roots.flatMap((r) => listJsonlFiles(r, 1)),
    sessionId: piSessionId,
    extractText: extractPiText,
  },
  codex: {
    source: "codex",
    defaultRoots: codexRoots,
    listFiles: (roots) => roots.flatMap((r) => listJsonlFiles(r, 3)),
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
