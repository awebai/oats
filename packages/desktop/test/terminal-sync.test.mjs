// The synchronized-output gate (#1193, renderer/terminal-sync.mjs): a tmux redraw
// wrapped in ESC[?2026h … ESC[?2026l reaches xterm in ONE write however the IPC
// split it, and every other byte reaches it at once and unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSyncGate, SYNC_BEGIN, SYNC_END, SYNC_TIMEOUT_MS } from "../renderer/terminal-sync.mjs";

/** Timers fire only when advanced. */
function fakeClock() {
  let now = 0, next = 1;
  const timers = new Map();
  return {
    setTimeout: (fn, ms) => { const id = next++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: id => { timers.delete(id); },
    pending: () => timers.size,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; timers.delete(due[0]); due[1].fn();
      }
      now = end;
    },
  };
}

function rig(options = {}) {
  const clock = fakeClock(), writes = [];
  const gate = createSyncGate({ write: data => writes.push(data), clock, ...options });
  return { clock, writes, gate, push: data => gate.push(data) };
}

// One keystroke's redraw as tmux sends it with the sync feature: cursor hidden, the
// input line repainted, the cursor shown and placed.
const BLOCK = `${SYNC_BEGIN}\x1b[?25l\x1b[23;3H\x1b[38;5;246m> fix the flicker é\u{1F389}\x1b[39m\x1b[K`
  + `\x1b[24;1H\x1b[2m? for shortcuts\x1b[22m\x1b[?25h\x1b[23;21H${SYNC_END}`;

/** Every complete block of `input`, as [start, end), scanning as the gate does without timeouts. */
function blocks(input) {
  const out = [];
  for (let at = input.indexOf(SYNC_BEGIN); at >= 0; at = input.indexOf(SYNC_BEGIN, at)) {
    const end = input.indexOf(SYNC_END, at + SYNC_BEGIN.length);
    if (end < 0) break;
    out.push([at, end + SYNC_END.length]); at = end + SYNC_END.length;
  }
  return out;
}

/** The concatenated writes are the input, and no write boundary falls inside a block. */
function assertWhole(writes, input, label = "") {
  assert.equal(writes.join(""), input, `byte for byte ${label}`);
  let offset = 0;
  const cuts = writes.map(w => (offset += w.length));
  for (const [start, end] of blocks(input)) {
    for (const cut of cuts) assert.ok(!(cut > start && cut < end), `a block split at ${cut} ${label}`);
  }
}

test("a block in one message is one write, unchanged, with no timer left", () => {
  const r = rig();
  r.push(BLOCK);
  assert.deepEqual(r.writes, [BLOCK]);
  assert.equal(r.clock.pending(), 0);
});

test("a block split in two at every position is one write, the 8-byte sequences included", () => {
  const input = `before${BLOCK}after`;
  for (let cut = 1; cut < input.length; cut++) {
    const r = rig();
    r.push(input.slice(0, cut)); r.push(input.slice(cut));
    assertWhole(r.writes, input, `(cut ${cut})`);
    assert.ok(r.writes.some(w => w.includes(BLOCK)), `the block is whole (cut ${cut})`);
    assert.equal(r.clock.pending(), 0, `nothing held (cut ${cut})`);
  }
});

test("a block split in three at every pair of positions is one write", () => {
  for (let a = 1; a < BLOCK.length - 1; a++) {
    for (let b = a + 1; b < BLOCK.length; b++) {
      const r = rig();
      r.push(BLOCK.slice(0, a)); r.push(BLOCK.slice(a, b));
      assert.deepEqual(r.writes, [], `held until its end (${a}, ${b})`);
      r.push(BLOCK.slice(b));
      assert.deepEqual(r.writes, [BLOCK], `(${a}, ${b})`);
    }
  }
});

test("a block across many messages, one character each, is one write", () => {
  const r = rig();
  for (const ch of BLOCK) r.push(ch);
  assert.deepEqual(r.writes, [BLOCK]);
});

test("output outside a block is written at once, one write per message, unchanged", () => {
  const r = rig();
  for (const chunk of ["plain", "\x1b[2J\x1b[H", "\x1b[?25l\x1b[1;1Hline\x1b[?25h", "é\u{1F389}", "\x1b[?2025h", "\x1b[?20261h"]) {
    r.push(chunk);
    assert.equal(r.writes.at(-1), chunk, JSON.stringify(chunk));
    assert.equal(r.clock.pending(), 0);
  }
  assert.equal(r.writes.length, 6);
});

test("text before and after a block in one message: everything written now, the block whole", () => {
  const r = rig();
  r.push(`pre${BLOCK}post`);
  assertWhole(r.writes, `pre${BLOCK}post`);
  assert.equal(r.clock.pending(), 0);
});

test("two blocks and the text between them in one message: each block whole", () => {
  const input = `a${BLOCK}between${BLOCK}z`;
  const r = rig();
  r.push(input);
  assertWhole(r.writes, input);
  assert.equal(r.clock.pending(), 0);
});

test("text before an unfinished block is written at once; the block waits for its end", () => {
  const r = rig();
  r.push(`typed${BLOCK.slice(0, 30)}`);
  assert.deepEqual(r.writes, ["typed"]);
  r.push(BLOCK.slice(30));
  assert.deepEqual(r.writes, ["typed", BLOCK]);
});

test("a block whose end never comes is written after 1000 ms; then output flows, and a later block still works", () => {
  const r = rig();
  r.push(`${SYNC_BEGIN}half a redraw`);
  r.clock.advance(SYNC_TIMEOUT_MS - 1);
  assert.deepEqual(r.writes, [], "held within the bound");
  r.push(" more");
  r.clock.advance(1);
  assert.deepEqual(r.writes, [`${SYNC_BEGIN}half a redraw more`], "the bound runs from the block's start");
  assert.equal(r.clock.pending(), 0);
  r.push("next");
  assert.deepEqual(r.writes.at(-1), "next", "not synchronizing any more");
  r.push(SYNC_END);
  assert.deepEqual(r.writes.at(-1), SYNC_END, "the late end passes through");
  r.push(BLOCK.slice(0, 12)); r.push(BLOCK.slice(12));
  assert.deepEqual(r.writes.at(-1), BLOCK);
});

test("the bound runs from the block's begin, not from a kept-back prefix of it", () => {
  const r = rig();
  r.push("\x1b[?20");
  r.clock.advance(600);
  r.push("26hheld");
  r.clock.advance(SYNC_TIMEOUT_MS - 1);
  assert.deepEqual(r.writes, [], "a full bound for the block");
  r.clock.advance(1);
  assert.deepEqual(r.writes, [`${SYNC_BEGIN}held`]);
});

test("a new kept-back prefix gets its own bound; one that only grows keeps its first", () => {
  // Replacement: an old ESC is written with unrelated text, and a new prefix is kept back
  // 1 ms before the old bound. The block it starts must not be cut at that old bound.
  const r = rig();
  r.push("\x1b");
  r.clock.advance(SYNC_TIMEOUT_MS - 1);
  r.push(`[31mtext${SYNC_BEGIN.slice(0, 4)}`);
  r.clock.advance(1);
  assert.deepEqual(r.writes, ["\x1b[31mtext"], "the new prefix is still held at the old bound");
  r.clock.advance(1);
  r.push(BLOCK.slice(4, 30)); r.clock.advance(1); r.push(BLOCK.slice(30));
  assert.deepEqual(r.writes, ["\x1b[31mtext", BLOCK]);
  assert.equal(r.clock.pending(), 0);
  // Extension: the same prefix growing keeps the deadline it got when it was first kept back.
  const e = rig();
  e.push("x\x1b");
  e.clock.advance(600);
  e.push("[?2");
  e.clock.advance(SYNC_TIMEOUT_MS - 600 - 1);
  assert.deepEqual(e.writes, ["x"]);
  e.clock.advance(1);
  assert.deepEqual(e.writes, ["x", "\x1b[?2"], "written at the first prefix's bound");
});

test("the timeout is the caller's to set", () => {
  const r = rig({ timeoutMs: 50 });
  r.push(SYNC_BEGIN);
  r.clock.advance(49); assert.deepEqual(r.writes, []);
  r.clock.advance(1); assert.deepEqual(r.writes, [SYNC_BEGIN]);
});

test("a stray end outside a block passes through at once", () => {
  const r = rig();
  r.push(`x${SYNC_END}y`);
  assert.deepEqual(r.writes, [`x${SYNC_END}y`]);
  assert.equal(r.clock.pending(), 0);
});

test("a repeated begin inside a block stays held with it", () => {
  const r = rig();
  r.push(`${SYNC_BEGIN}one${SYNC_BEGIN}two`);
  assert.deepEqual(r.writes, []);
  r.push(`three${SYNC_END}`);
  assert.deepEqual(r.writes, [`${SYNC_BEGIN}one${SYNC_BEGIN}twothree${SYNC_END}`]);
});

test("a trailing ESC of an unrelated sequence reaches xterm with the next message, or at the timeout", () => {
  const r = rig();
  r.push("red\x1b");
  assert.deepEqual(r.writes, ["red"], "only the possible start is kept back");
  r.push("[31m!");
  assert.deepEqual(r.writes, ["red", "\x1b[31m!"]);
  assert.equal(r.clock.pending(), 0);
  r.push("\x1b[?202");
  r.clock.advance(SYNC_TIMEOUT_MS);
  assert.deepEqual(r.writes.at(-1), "\x1b[?202", "a prefix that never completes is written at the bound");
  assert.equal(r.clock.pending(), 0);
  r.push("6h");
  assert.deepEqual(r.writes.at(-1), "6h", "written as it is: the gate already let the prefix go");
});

test("only a proper prefix of the sequence is kept back, the longest one", () => {
  for (let n = 1; n < SYNC_BEGIN.length; n++) {
    const r = rig();
    r.push(`x${SYNC_BEGIN.slice(0, n)}`);
    assert.deepEqual(r.writes, ["x"], `prefix of ${n}`);
  }
  const r = rig();
  r.push("\x1b[?2\x1b[?20");
  assert.deepEqual(r.writes, ["\x1b[?2"], "an earlier broken prefix goes now");
});

test("text in and around blocks keeps its surrogate pairs: no write holds half a character", () => {
  const r = rig(), lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const input = `\u{1F389}${SYNC_BEGIN}\u{1F600}é\u{1F600}${SYNC_END}\u{1F389}\x1b`;
  for (const piece of ["\u{1F389}\x1b[?20", `26h\u{1F600}é`, `\u{1F600}\x1b[?2026`, "l\u{1F389}\x1b"]) r.push(piece);
  r.gate.flush();
  assertWhole(r.writes, input);
  for (const w of r.writes) assert.ok(!lone.test(w), JSON.stringify(w));
});

test("flush writes what is held and ends the block", () => {
  const r = rig();
  r.push(`${SYNC_BEGIN}partial`);
  r.gate.flush();
  assert.deepEqual(r.writes, [`${SYNC_BEGIN}partial`]);
  assert.equal(r.clock.pending(), 0);
  r.push(`rest${SYNC_END}`);
  assert.deepEqual(r.writes.at(-1), `rest${SYNC_END}`);
  r.gate.flush();
  assert.equal(r.writes.length, 2, "nothing held, nothing written");
});

test("dispose drops what is held, stops the timer and ignores later output", () => {
  const r = rig();
  r.push(`${SYNC_BEGIN}partial`);
  r.gate.dispose();
  assert.equal(r.clock.pending(), 0);
  r.push(`rest${SYNC_END}plain`); r.gate.flush(); r.clock.advance(SYNC_TIMEOUT_MS * 2);
  assert.deepEqual(r.writes, []);
});

test("a non-string message flushes what is held and passes through", () => {
  const r = rig(), bytes = new Uint8Array([104, 105]);
  r.push(SYNC_BEGIN); r.push(bytes);
  assert.deepEqual(r.writes, [SYNC_BEGIN, bytes]);
  assert.equal(r.clock.pending(), 0);
});

// Seeded, so a failure reproduces: random output built from the sequences' own pieces,
// split at random. Without the timeout, every message's writes are exactly what can be
// written (all but an open block or a trailing prefix of its begin), and once flushed the
// writes are the input, with no block split.
test("property: random output and random splits keep every byte, in order, and every block whole", () => {
  let seed = 1193;
  const random = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const pieces = [SYNC_BEGIN, SYNC_END, "\x1b", "\x1b[", "\x1b[?", "\x1b[?2026", "h", "l", "2026", "?", "[", "x", "é", "\u{1F389}", "\x1b[?25l", "\r\n"];
  for (let round = 0; round < 400; round++) {
    let input = "";
    for (let i = random(40); i >= 0; i--) input += pieces[random(pieces.length)];
    const r = rig();
    let pushed = "";
    for (let at = 0; at < input.length;) {
      const next = Math.min(input.length, at + 1 + random(12));
      r.push(input.slice(at, next)); pushed = input.slice(0, next); at = next;
      const written = r.writes.join("").length, open = openBlockStart(pushed);
      const expected = open >= 0 ? open : pushed.length - trailing(pushed);
      assert.equal(written, expected, `nothing more held than must be (round ${round}, ${JSON.stringify(pushed)})`);
    }
    r.gate.flush();
    assertWhole(r.writes, input, `(round ${round})`);
    assert.equal(r.clock.pending(), 0);
  }
});

function openBlockStart(text) {
  let from = 0;
  for (;;) {
    const begin = text.indexOf(SYNC_BEGIN, from);
    if (begin < 0) return -1;
    const end = text.indexOf(SYNC_END, begin + SYNC_BEGIN.length);
    if (end < 0) return begin;
    from = end + SYNC_END.length;
  }
}
function trailing(text) {
  for (let n = SYNC_BEGIN.length - 1; n > 0; n--) if (text.endsWith(SYNC_BEGIN.slice(0, n))) return n;
  return 0;
}
