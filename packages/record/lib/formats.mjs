// Session transcript formats the record knows how to capture.
//
// The storage contract is format-agnostic (verbatim blob + session turn);
// a format contributes only: where its transcripts live, how to name a
// session, and how to extract conversational text for the derived index.
// Every format's records carry a top-level `timestamp` string, so the
// last-timestamp/event-count scan in capture is shared.
//
// Indexing policy, uniform across formats: user and assistant TEXT only.
// Tool output and thinking stay in the blob (verbatim, recallable via the
// session turn) but are not searchable — indexing them would bury
// conversational hits in noise. Note pi persists readable thinking on
// disk; it lands in the blob like everything else, and stays unindexed by
// this same policy.

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

function textParts(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
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

export function extractCcText(bytes) {
  const docs = [];
  for (const { d, lineNo } of parsedLines(bytes)) {
    if (d.type !== "user" && d.type !== "assistant") continue;
    const text = textParts(d.message?.content);
    if (text.trim()) docs.push({ loc: `line:${lineNo}`, role: d.type, text });
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
    if (d.type !== "message") continue;
    const role = d.message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = textParts(d.message?.content);
    if (text.trim()) docs.push({ loc: `line:${lineNo}`, role, text });
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
    const payload = d.payload;
    if (payload?.type !== "message") continue;
    const role = payload.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = payload.content;
    const text = Array.isArray(content)
      ? content
          .filter((p) => typeof p?.text === "string")
          .map((p) => p.text)
          .join("\n")
      : "";
    if (text.trim()) docs.push({ loc: `line:${lineNo}`, role, text });
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
