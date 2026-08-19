// The reader (Jiminy): follows an agent's life sequentially and segments
// it — the consciousness's core competence, per the selection-subsystem
// design. It reads FULL conversation (tool calls and results included;
// per-entry display is bounded for window size, with explicit truncation
// markers — the blob always holds every byte), holds the running open
// segments across windows, and records its conclusions as segment turns.
//
// Backfill (read a historical thread) and follow (read as capture lands
// new events) are the same operation: read from the last annotated
// position. State is authoritative in the record — the open segments are
// the ones recorded as `ongoing` — so a crashed or restarted reader
// resumes by reading its own prior conclusions.

import { extractSessionTextFor } from "./formats.mjs";
import { runEngine, LibrarianError } from "./librarian.mjs";
import { segmentTurnCore, segmentsFor, SEGMENT_OUTCOMES, SEGMENT_TYPES } from "./segments.mjs";
import { finishTurn } from "./canonical.mjs";

export class ReaderError extends Error {}

// Per-entry display cap inside a reader window. Bounded presentation,
// not stripping: the marker names the cut and the blob keeps the bytes.
const ENTRY_CAP = 4000;
const DEFAULT_WINDOW_CHARS = 80000;

export const READER_CHARTER = `You are the consciousness (a reader) following another agent's working life, one conversation read in order. Your only job: segment it into the pieces that carry meaning — the units a future agent could wear as context.

A segment is a contiguous stretch of the conversation that does ONE thing. Its type is the ACTIVITY only:
- exploration: learning (reading code/docs, gathering facts). What matters is what it established.
- design: an argument or discussion that produced a decision or direction.
- implementation: building one thing, across many turns of edits/tests/tool runs.
- review: a review round and the fixes it drove.
- handoff: transitions, summaries written for others, compaction.
- admin: setup, bookkeeping, idle coordination noise.

Wrongness is NEVER a type — a misconceived implementation is still an implementation. Wrongness lives in the outcome:
- outcome: fruitful | dead-end (misconceived, reverted, or ruled wrong) | superseded (later work replaced it) | ongoing (still open at the end of what you have seen).
- When outcome is dead-end, add "lesson": the one thing that survives the failure, if anything does.
- Be alert for dead ends: an implementation that gets discarded, an experiment whose premise is later rejected. Evidence later in the conversation may retroactively reveal an earlier segment as a dead end — say so by revising it.

Rules:
- Boundaries sit where the PURPOSE shifts, not where topics drift. Tool calls and results belong to the segment whose purpose they serve.
- Spans are HALF-OPEN: "end" is the first line AFTER the segment (start <= line < end). Adjacent segments share the boundary number: one segment's end equals the next segment's start.
- "established" must be concrete: what was produced, learned, or decided — names, decisions, artifacts. Never vague ("worked on X").
- You will receive the conversation in windows. OPEN SEGMENTS from earlier windows are given back to you; extend them, close them, or revise them as new evidence arrives.
- Segments must cover the conversation without large gaps; small glue (a one-line ack) may attach to a neighbor.

Respond with ONLY one JSON object:
{"segments": [{"start": "line:N", "end": "line:M" or null if still open, "type": "...", "about": ["slug", ...], "established": "...", "outcome": "...", "lesson": "..." (only for dead-end)}]}
Include every open segment you were given (revised as needed) plus new ones. Use the line refs shown in the window.`;

function renderEntry(e) {
  let text = e.text;
  if (text.length > ENTRY_CAP) {
    text =
      text.slice(0, ENTRY_CAP) +
      ` [+${text.length - ENTRY_CAP} chars truncated for window; full content in record]`;
  }
  return `[${e.loc}] ${e.role}${e.ts ? ` (${e.ts})` : ""}: ${text}`;
}

// Load the thread's full-fidelity entries (all roles). Sessions are one
// turn per native event, stored in per-session streams; a session entry's
// turnId is the event turn itself, and loc is its source line number.
export function readerEntries(store, thread) {
  const sessionStreams = store.sessionStreamsFor(thread);
  if (sessionStreams.length > 0) {
    // Tombstones live in ordinary streams but must hide session events
    // too: a per-line redaction that search respects while the reader and
    // dress resurrect the line is a redaction that does not work.
    const claims = store.tombstoneClaims();
    const byId = new Map();
    for (const sid of sessionStreams) {
      for (const t of store.readStream(sid)) {
        if (store.claimHides(claims, t)) continue;
        if (t.thread === thread && typeof t.body?.line === "string" && !byId.has(t.id)) {
          byId.set(t.id, t);
        }
      }
    }
    const turns = [...byId.values()].sort(
      (a, b) => (a.provenance?.origin?.line ?? 0) - (b.provenance?.origin?.line ?? 0),
    );
    const entries = [];
    for (const t of turns) {
      const loc = `line:${t.provenance?.origin?.line ?? 0}`;
      for (const d of extractSessionTextFor(t.provenance?.source, Buffer.from(t.body.line, "utf8"))) {
        entries.push({ loc, role: d.role, ts: t.ts, text: d.text, turnId: t.id });
      }
    }
    return entries;
  }
  const byId = store.readAll();
  return [...byId.values()]
    .map(({ turn }) => turn)
    .filter((t) => t.thread === thread && t.provenance?.source !== "mind")
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.id.localeCompare(b.id))
    .map((t, i) => ({
      loc: `line:${i + 1}`,
      role: t.kind,
      ts: t.ts,
      text: (t.body?.subject ? t.body.subject + "\n" : "") + (t.body?.text ?? ""),
      turnId: t.id,
    }));
}

export function buildReaderPrompt({ openSegments, windowEntries, threadNote }) {
  const parts = [READER_CHARTER, ""];
  if (threadNote) parts.push(`CONTEXT: ${threadNote}\n`);
  if (openSegments.length > 0) {
    parts.push("OPEN SEGMENTS (from your earlier reading; extend, close, or revise):");
    for (const s of openSegments) {
      parts.push(
        `- start=${s.start} type=${s.type} about=${(s.about ?? []).join(",")} established="${s.established}"`,
      );
    }
    parts.push("");
  }
  parts.push("WINDOW:");
  for (const e of windowEntries) parts.push(renderEntry(e));
  return parts.join("\n");
}

// Shape AND referential validity: a segment's refs must name real
// entries of this thread and end must not precede start. A hostile or
// confused engine response with fabricated refs would otherwise be
// persisted and — worse — corrupt the resume cursor into perpetual
// expensive re-reads (reviewer-demonstrated).
function validSegment(raw, knownLocs, locNum, maxLoc) {
  if (
    !raw ||
    typeof raw.start !== "string" ||
    !SEGMENT_TYPES.has(raw.type) ||
    !(raw.end === null || raw.end === undefined || typeof raw.end === "string") ||
    typeof raw.established !== "string" ||
    raw.established.trim().length === 0
  ) {
    return false;
  }
  // Start must name a real entry; end is a half-open bound — any line
  // number strictly after start, at most one past the thread's last line.
  if (!knownLocs.has(raw.start)) return false;
  if (raw.end !== null && raw.end !== undefined) {
    const e = locNum(raw.end);
    if (!Number.isFinite(e) || e <= locNum(raw.start) || e > maxLoc + 1) return false;
  }
  return true;
}

// Cap for carried-forward open-segment summaries and the thread note in
// reader prompts: what is re-fed matches what is persisted, and prompt
// size stays bounded by windowChars plus a constant.
const CARRY_CAP = 300;
const NOTE_CAP = 2000;

// Read one thread from its last annotated position to the end, in windows,
// writing segment turns after each window. Returns a summary.
export function readThread(
  store,
  { thread, engine, engineLabel, windowChars = DEFAULT_WINDOW_CHARS, threadNote, onWindow },
) {
  if (!engine) throw new ReaderError("an engine command is required (--engine or TURN_RECORD_ENGINE)");
  const entries = readerEntries(store, thread);
  if (entries.length === 0) return { windows: 0, segments: 0, entries: 0 };

  const locNum = (ref) => Number(/line:(\d+)/.exec(ref)?.[1] ?? 0);
  const knownLocs = new Set(entries.map((e) => e.loc));
  const maxLoc = Math.max(...entries.map((e) => locNum(e.loc)));
  const streamId = `${store.owner}~mind`;

  // Resume point: everything at or before the highest CLOSED annotation is
  // done; open (ongoing) segments are carried into the next window.
  const existing = segmentsFor(store, thread);
  const doneUpTo = existing.filter((s) => s.end).reduce((m, s) => Math.max(m, locNum(s.end)), 0);
  let open = existing.filter((s) => !s.end || s.outcome === "ongoing");
  let cursor = entries.findIndex((e) => locNum(e.loc) > doneUpTo);
  if (cursor === -1) return { windows: 0, segments: existing.length, entries: entries.length };

  let windows = 0;
  let written = 0;
  while (cursor < entries.length) {
    const windowEntries = [];
    let size = 0;
    while (cursor < entries.length && (size < windowChars || windowEntries.length === 0)) {
      const e = entries[cursor];
      windowEntries.push(e);
      size += Math.min(e.text.length, ENTRY_CAP) + 40;
      cursor++;
    }
    windows++;

    const prompt = buildReaderPrompt({ openSegments: open, windowEntries, threadNote: threadNote?.slice(0, NOTE_CAP) });
    const engineStart = Date.now();
    const verdict = runEngine(engine, prompt, { timeoutMs: 600000 });
    const engineMs = Date.now() - engineStart;
    if (!Array.isArray(verdict.segments)) {
      throw new ReaderError("reader engine returned no segments[]");
    }
    const accepted = verdict.segments.filter((raw) => validSegment(raw, knownLocs, locNum, maxLoc));
    if (accepted.length === 0 && windowEntries.length > 3) {
      throw new ReaderError(
        `reader returned no valid segments for a ${windowEntries.length}-entry window; refusing to advance silently`,
      );
    }

    const endTs = new Date(0).toISOString();
    const fresh = [];
    const known = new Set(store.readStream(streamId).map((t) => t.id));

    // Boundary moves: when an accepted segment overlaps an EXISTING one of
    // a different identity, the orchestrator supersedes the displaced
    // identity — never left to reader discipline (frozen model rule).
    const currentMap = segmentsFor(store, thread);
    for (const ex of currentMap) {
      if (ex.outcome === "superseded") continue;
      const exStart = locNum(ex.start);
      const exEnd = ex.end ? locNum(ex.end) : Infinity;
      for (const raw of accepted) {
        if (raw.start === ex.start) continue; // same identity: plain revision
        const aStart = locNum(raw.start);
        const aEnd = raw.end ? locNum(raw.end) : Infinity;
        if (aStart < exEnd && exStart < aEnd) {
          const sup = segmentTurnCore({
            owner: store.owner,
            thread,
            start: ex.start,
            end: ex.end,
            type: ex.type,
            about: ex.about,
            established: ex.established,
            outcome: "superseded",
            lesson: ex.lesson ?? undefined,
            // Strictly later than the displaced revision, or latest-wins
            // could keep the old judgment.
            ts: new Date(
              Math.max(
                Date.parse(windowEntries[windowEntries.length - 1].ts || endTs) || 0,
                (Date.parse(ex.ts) || 0) + 1,
              ),
            ).toISOString(),
            model: engineLabel,
          });
          const supTurn = finishTurn(sup);
          if (!known.has(supTurn.id)) {
            fresh.push(supTurn);
            known.add(supTurn.id);
          }
          break;
        }
      }
    }
    for (const raw of accepted) {
      const outcome =
        raw.end === null || raw.end === undefined
          ? "ongoing"
          : SEGMENT_OUTCOMES.has(raw.outcome)
            ? raw.outcome
            : "fruitful";
      const core = segmentTurnCore({
        owner: store.owner,
        thread,
        start: raw.start,
        end: raw.end ?? null,
        type: raw.type,
        about: Array.isArray(raw.about) ? raw.about.map(String).slice(0, 5) : [],
        established: raw.established,
        outcome,
        lesson: typeof raw.lesson === "string" && raw.lesson.trim() ? raw.lesson : undefined,
        ts: windowEntries[windowEntries.length - 1].ts || endTs,
        model: engineLabel,
      });
      const turn = finishTurn(core);
      if (!known.has(turn.id)) {
        fresh.push(turn);
        known.add(turn.id);
      }
    }
    store.appendBatch(streamId, fresh);
    written += fresh.length;
    // Accepted limitation, on the record: an open segment carried across
    // windows is represented by its compact summary only — its earlier
    // turns are never re-shown (re-showing full history would defeat
    // windowing). A later revision is only as good as this summary.
    open = accepted
      .filter((s) => s.end === null || s.end === undefined)
      .map((s) => ({
        start: s.start,
        type: s.type,
        about: s.about ?? [],
        established: s.established.slice(0, CARRY_CAP),
        outcome: "ongoing",
      }));
    if (onWindow) onWindow({ windows, written, cursor, total: entries.length, open: open.length, engineMs });
  }

  return { windows, segments: written, entries: entries.length, open: open.length };
}

export { LibrarianError };
