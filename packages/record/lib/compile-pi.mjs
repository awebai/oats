// Compile an outfit into a native pi session file — the dress made real.
//
// The goal (Juan): extract the conversation turns for a task from the
// record, create a session file in the harness's native format, and spawn
// the agent with the context already built in. This module does the pi
// half: outfit -> segments -> per-event turns -> pi session v3 JSONL,
// plus the spawn note that maps the new agent to the segments it wears.
//
// Format authority: pi's own docs/session-format.md (v3). Every entry
// except the header carries { id: 8-hex, parentId, timestamp }. Messages
// are AgentMessage objects; custom_message entries are the documented
// mechanism for injected context that participates in the LLM context.
//
// Cross-provider rules, established empirically against openai-codex and
// consistent with the schema:
// - thinking content is NEVER replayed as {type:"thinking"} — providers
//   that sign reasoning reject foreign thinking and pi retries forever.
//   It is folded into assistant text under a "[thinking]" marker.
// - toolCall/toolResult pairs replay fine, with their original tool names
//   and arguments, PROVIDED the pair is complete. A call whose result is
//   outside the segment is folded into text; an orphan result becomes a
//   custom_message.
// - base64 payloads (images, documents) become descriptive placeholders;
//   the record keeps the real bytes, the dress does not carry them.

import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { finishTurn } from "./canonical.mjs";
import { parseOutfit } from "./tags.mjs";
import { parseSegment, spawnTurnCore } from "./segments.mjs";

export class CompileError extends Error {}

const locNum = (ref) => Number(/line:(\d+)/.exec(ref ?? "")?.[1] ?? NaN);

function safeJson(v) {
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return String(v);
  }
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return safeJson(content);
  return content
    .map((p) => (typeof p?.text === "string" ? p.text : typeof p?.thinking === "string" ? p.thinking : safeJson(p)))
    .join("\n");
}

function placeholderFor(part) {
  const data = part?.source?.data ?? part?.data;
  if (typeof data === "string" && data.length > 256) {
    const media = part.source?.media_type ?? part.source?.mediaType ?? part.mimeType ?? "binary";
    return `[${part.type}: ${media}, ${data.length} base64 chars; full content in the record]`;
  }
  return null;
}

function toolArgs(part) {
  // pi stores arguments as an object; cc as `input`; codex as a JSON
  // string. Normalize to an object (the documented ToolCall shape).
  const raw = part.input ?? part.arguments;
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* not JSON: wrap below */
    }
    return { raw };
  }
  return {};
}

// ------------------------------------------------- per-format item mappers

// One captured native record -> neutral conversation items:
//   { kind: "user",        parts: [{type:"text",text}] }
//   { kind: "assistant",   parts: [{type:"text"|...}, {type:"toolCall",...}] }
//   { kind: "tool_result", callId, name, text, isError }
//   { kind: "context",     text }   (system notices, attachments, custom)
// Thinking arrives folded into assistant text parts already.

function ccItems(d) {
  const items = [];
  if (d.type === "user") {
    const content = d.message?.content;
    if (typeof content === "string") {
      if (content.trim()) items.push({ kind: "user", parts: [{ type: "text", text: content }] });
      return items;
    }
    if (!Array.isArray(content)) return items;
    const textParts = [];
    for (const part of content) {
      if (part?.type === "tool_result") {
        items.push({
          kind: "tool_result",
          callId: String(part.tool_use_id ?? ""),
          name: null,
          text: textOf(part.content),
          isError: part.is_error === true,
        });
      } else if (part?.type === "text" && typeof part.text === "string") {
        if (part.text.trim()) textParts.push({ type: "text", text: part.text });
      } else if (part) {
        const ph = placeholderFor(part);
        textParts.push({ type: "text", text: ph ?? safeJson(part) });
      }
    }
    if (textParts.length > 0) items.push({ kind: "user", parts: textParts });
    return items;
  }
  if (d.type === "assistant") {
    const content = d.message?.content;
    const parts = [];
    for (const part of Array.isArray(content) ? content : []) {
      if (part?.type === "text" && typeof part.text === "string") {
        if (part.text.trim()) parts.push({ type: "text", text: part.text });
      } else if (part?.type === "thinking") {
        const t = typeof part.thinking === "string" ? part.thinking : "";
        if (t.trim()) parts.push({ type: "text", text: `[thinking]\n${t}` });
      } else if (part?.type === "tool_use") {
        parts.push({ type: "toolCall", id: String(part.id ?? ""), name: String(part.name ?? "tool"), arguments: toolArgs(part) });
      } else if (part) {
        const ph = placeholderFor(part);
        parts.push({ type: "text", text: ph ?? safeJson(part) });
      }
    }
    if (parts.length > 0) items.push({ kind: "assistant", parts });
    return items;
  }
  if (d.type === "system") {
    const text = typeof d.content === "string" ? d.content : safeJson(d.content);
    if (String(text).trim()) items.push({ kind: "context", text: `[system]\n${text}` });
    return items;
  }
  if (d.type === "attachment") {
    const text = safeJson(d.attachment);
    if (text && text !== "null") items.push({ kind: "context", text: `[attachment]\n${text}` });
  }
  return items;
}

function piItems(d) {
  const items = [];
  if (d.type === "custom_message") {
    const text = textOf(d.content);
    if (text.trim()) items.push({ kind: "context", text });
    return items;
  }
  if (d.type !== "message") return items;
  const m = d.message;
  if (m?.role === "user") {
    const parts = [];
    const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    for (const part of Array.isArray(content) ? content : []) {
      if (part?.type === "text" && typeof part.text === "string") {
        if (part.text.trim()) parts.push({ type: "text", text: part.text });
      } else if (part) {
        const ph = placeholderFor(part);
        parts.push({ type: "text", text: ph ?? safeJson(part) });
      }
    }
    if (parts.length > 0) items.push({ kind: "user", parts });
    return items;
  }
  if (m?.role === "assistant") {
    const parts = [];
    for (const part of Array.isArray(m.content) ? m.content : []) {
      if (part?.type === "text" && typeof part.text === "string") {
        if (part.text.trim()) parts.push({ type: "text", text: part.text });
      } else if (part?.type === "thinking") {
        const t = typeof part.thinking === "string" ? part.thinking : "";
        if (t.trim()) parts.push({ type: "text", text: `[thinking]\n${t}` });
      } else if (part?.type === "toolCall") {
        parts.push({ type: "toolCall", id: String(part.id ?? ""), name: String(part.name ?? "tool"), arguments: toolArgs(part) });
      } else if (part) {
        const ph = placeholderFor(part);
        parts.push({ type: "text", text: ph ?? safeJson(part) });
      }
    }
    if (parts.length > 0) items.push({ kind: "assistant", parts });
    return items;
  }
  if (m?.role === "toolResult") {
    items.push({
      kind: "tool_result",
      callId: String(m.toolCallId ?? ""),
      name: typeof m.toolName === "string" ? m.toolName : null,
      text: textOf(m.content),
      isError: m.isError === true,
    });
  }
  return items;
}

function codexItems(d) {
  const items = [];
  if (d.type !== "response_item") return items;
  const p = d.payload;
  if (!p || typeof p !== "object") return items;
  if (p.type === "message" && (p.role === "user" || p.role === "assistant")) {
    const text = Array.isArray(p.content)
      ? p.content.filter((x) => typeof x?.text === "string").map((x) => x.text).join("\n")
      : "";
    if (text.trim()) {
      items.push(
        p.role === "user"
          ? { kind: "user", parts: [{ type: "text", text }] }
          : { kind: "assistant", parts: [{ type: "text", text }] },
      );
    }
    return items;
  }
  if (p.type === "reasoning") {
    const text = Array.isArray(p.summary)
      ? p.summary.map((x) => (typeof x?.text === "string" ? x.text : "")).join("\n")
      : "";
    if (text.trim()) items.push({ kind: "assistant", parts: [{ type: "text", text: `[thinking]\n${text}` }] });
    return items;
  }
  if (p.type === "function_call" || p.type === "custom_tool_call") {
    items.push({
      kind: "assistant",
      parts: [{ type: "toolCall", id: String(p.call_id ?? p.id ?? ""), name: String(p.name ?? "tool"), arguments: toolArgs(p) }],
    });
    return items;
  }
  if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
    const out = p.output;
    items.push({
      kind: "tool_result",
      callId: String(p.call_id ?? ""),
      name: null,
      text: typeof out === "string" ? out : safeJson(out),
      isError: false,
    });
  }
  return items;
}

const ITEM_MAPPERS = { cc: ccItems, pi: piItems, codex: codexItems };

export function conversationItems(source, record) {
  const mapper = ITEM_MAPPERS[source];
  return mapper ? mapper(record) : [];
}

// ------------------------------------------------------ session assembly

const CUSTOM_TYPE = "turn-record-dress";

// Deterministic 8-hex entry ids: the same outfit compiled with the same
// session id yields byte-identical entries.
function entryId(sessionId, n) {
  return createHash("sha256").update(`${sessionId}:${n}`).digest("hex").slice(0, 8);
}

// Assemble neutral items (with segment boundaries) into pi v3 entries.
// `chunks` is [{ marker, items }] — one chunk per segment, marker text
// introduces it as a custom_message.
export function assembleEntries(chunks, { sessionId, cwd, now }) {
  const entries = [{ type: "session", version: 3, id: sessionId, timestamp: now, cwd }];
  let parentId = null;
  let n = 0;
  const push = (entry) => {
    const id = entryId(sessionId, n++);
    entries.push({ ...entry, id, parentId, timestamp: now });
    parentId = id;
  };
  const nowMs = Date.parse(now);
  const assistantBase = {
    api: "replay",
    provider: "turn-record",
    model: "dress-replay",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    timestamp: nowMs,
  };

  for (const { marker, items } of chunks) {
    if (marker) {
      push({ type: "custom_message", customType: CUSTOM_TYPE, content: marker, display: true });
    }
    // Pairing plan: a toolCall replays natively only when it is the FIRST
    // occurrence of its id AND a result for that id appears strictly
    // LATER in the same chunk. Anything else — duplicate call ids, a
    // result arriving before its call, a pair split across segments —
    // degrades to text, never to a dangling native tool-use. Honest
    // captures always order call-before-result; this guards hand-crafted
    // or malformed transcripts and future formats.
    const firstCall = new Map(); // callId -> { index, name }
    const pairedResult = new Map(); // callId -> result item index
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "assistant") {
        for (const p of it.parts) {
          if (p.type === "toolCall" && p.id && !firstCall.has(p.id)) {
            firstCall.set(p.id, { index: i, name: p.name });
          }
        }
      } else if (it.kind === "tool_result" && it.callId) {
        const call = firstCall.get(it.callId);
        if (call && call.index < i && !pairedResult.has(it.callId)) {
          pairedResult.set(it.callId, i);
        }
      }
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "user") {
        push({ type: "message", message: { role: "user", content: item.parts, timestamp: nowMs } });
      } else if (item.kind === "context") {
        push({ type: "custom_message", customType: CUSTOM_TYPE, content: item.text, display: true });
      } else if (item.kind === "assistant") {
        const parts = [];
        let calls = 0;
        for (const part of item.parts) {
          if (part.type === "toolCall") {
            const call = part.id ? firstCall.get(part.id) : undefined;
            if (call && call.index === i && pairedResult.has(part.id)) {
              parts.push(part);
              calls++;
            } else {
              parts.push({ type: "text", text: `[tool call — ${part.name}]\n${safeJson(part.arguments)}` });
            }
          } else {
            parts.push(part);
          }
        }
        push({
          type: "message",
          message: { role: "assistant", content: parts, stopReason: calls > 0 ? "toolUse" : "stop", ...assistantBase },
        });
      } else if (item.kind === "tool_result") {
        if (pairedResult.get(item.callId) === i) {
          push({
            type: "message",
            message: {
              role: "toolResult",
              toolCallId: item.callId,
              toolName: item.name ?? firstCall.get(item.callId).name,
              content: [{ type: "text", text: item.text }],
              isError: item.isError === true,
              timestamp: nowMs,
            },
          });
        } else {
          // Orphan result: its call is outside the chunk, folded, or a
          // duplicate — the pair was never replayed natively.
          push({
            type: "custom_message",
            customType: CUSTOM_TYPE,
            content: `[tool result${item.name ? ` — ${item.name}` : ""}]\n${item.text}`,
            display: true,
          });
        }
      }
    }
  }
  return entries;
}

// pi's session directory name for a cwd: '/' -> '-', wrapped in '-' / '--'.
export function piProjectDir(cwd) {
  return "-" + cwd.replaceAll("/", "-") + "--";
}

export function piSessionPath(cwd, sessionId, now, sessionDir = join(homedir(), ".pi", "agent", "sessions")) {
  const stamp = now.replaceAll(":", "-").replace(".", "-");
  return join(sessionDir, piProjectDir(cwd), `${stamp}_${sessionId}.jsonl`);
}

// ------------------------------------------------------------- the dress

// Resolve an outfit to its segments and pull each segment's events from
// the record. Tombstoned events stay redacted in the dress, exactly as in
// every other read path.
export function outfitChunks(store, outfitRef) {
  const byId = store.readAll();
  const hidden = store.hiddenIds(byId);
  const claims = store.tombstoneClaims(byId);
  const outfitTurn = byId.get(outfitRef)?.turn;
  if (!outfitTurn || hidden.has(outfitRef)) throw new CompileError(`outfit ${outfitRef} not found`);
  const outfit = parseOutfit(outfitTurn);
  if (!outfit) throw new CompileError(`turn ${outfitRef} is not an outfit`);

  const chunks = [];
  for (const memberRef of outfit.members) {
    const memberTurn = byId.get(memberRef)?.turn;
    if (!memberTurn || hidden.has(memberRef)) throw new CompileError(`outfit member ${memberRef} not found`);
    const seg = parseSegment(memberTurn);
    if (!seg) throw new CompileError(`outfit member ${memberRef} is not a segment`);
    const start = locNum(seg.start);
    const end = seg.end ? locNum(seg.end) : Number.MAX_SAFE_INTEGER;

    const events = [];
    for (const sid of store.sessionStreamsFor(seg.thread)) {
      for (const t of store.readStream(sid)) {
        if (store.claimHides(claims, t)) continue;
        if (t.thread !== seg.thread || typeof t.body?.line !== "string") continue;
        const line = t.provenance?.origin?.line ?? 0;
        if (line < start || line >= end) continue;
        const prior = events.find((e) => e.line === line);
        if (prior) {
          // Two owners captured the same session: same line must mean the
          // same bytes. Divergence is corruption or tampering — fail loud,
          // never silently pick a winner (mergeStreamCopy's philosophy).
          if (prior.text !== t.body.line) {
            throw new CompileError(`streams for ${seg.thread} diverge at line ${line}`);
          }
          continue;
        }
        events.push({ line, source: t.provenance?.source, text: t.body.line });
      }
    }
    events.sort((a, b) => a.line - b.line);

    const items = [];
    for (const e of events) {
      let record;
      try {
        record = JSON.parse(e.text);
      } catch {
        continue; // non-JSON native line: nothing conversational to replay
      }
      items.push(...conversationItems(e.source, record));
    }
    const marker =
      `[dressed context — ${seg.type}, ${seg.outcome}] ${seg.established}` +
      (seg.lesson ? `\n[lesson] ${seg.lesson}` : "");
    chunks.push({ marker, items, segment: seg, memberRef });
  }
  return { outfit, chunks };
}

// Compile an outfit into a pi session file on disk and record the spawn
// note (agent -> outfit -> segments) at the moment of creation.
export function compileOutfit(
  store,
  { outfit: outfitRef, owner, task, cwd = process.cwd(), sessionDir, sessionId, now, log = true },
) {
  if (!outfitRef) throw new CompileError("an outfit ref is required");
  if (!owner) throw new CompileError("an owner is required for the spawn note");
  let realCwd;
  try {
    realCwd = realpathSync(cwd);
  } catch {
    throw new CompileError(`cwd ${cwd} does not exist`);
  }
  const id = sessionId ?? cryptoRandomUuid();
  const stamp = now ?? new Date().toISOString();
  const { outfit, chunks } = outfitChunks(store, outfitRef);
  const entries = assembleEntries(chunks, { sessionId: id, cwd: realCwd, now: stamp });
  const path = piSessionPath(realCwd, id, stamp, sessionDir);
  mkdirSync(join(path, ".."), { recursive: true });
  // Write-then-rename: pi must never see a half-written session file.
  const tmp = path + ".tmp-" + process.pid;
  writeFileSync(tmp, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  renameSync(tmp, path);

  const agentThread = `pi:session:${id}`;
  let spawn = null;
  if (log) {
    const { turn } = store.appendCore(
      `${owner}~mind`,
      spawnTurnCore({
        owner,
        agentThread,
        outfit: outfitRef,
        task: task ?? outfit.task,
        harness: "pi",
        ts: stamp,
      }),
    );
    spawn = turn;
  }
  return {
    path,
    sessionId: id,
    agentThread,
    entries: entries.length,
    segments: chunks.length,
    spawn,
    command: `pi --session ${path}`,
  };
}

function cryptoRandomUuid() {
  return globalThis.crypto.randomUUID();
}
