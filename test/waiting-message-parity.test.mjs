// The waiting --message rule, pinned by a fixture the kernel and the Desktop share:
// test/fixtures/waiting-message-parity.json. This test asserts the kernel's predicate
// (validWaitingMessage) gives each case's `valid`; the Desktop's test reads the same file
// and asserts its own check does too, so the two cannot drift apart. A case is
// {id, text, valid, why}, or {id, unit, repeat, valid, why} for a long string (`unit`
// repeated `repeat` times). Non-ASCII is written as JSON escapes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validWaitingMessage } from "../lib/instance-events.mjs";

const FIXTURE = new URL("./fixtures/waiting-message-parity.json", import.meta.url);
const cases = JSON.parse(readFileSync(FIXTURE, "utf8"));
const textOf = (c) => (c.repeat === undefined ? c.text : c.unit.repeat(c.repeat));

// The cases the maintainer's set requires; the fixture may grow, never lose one.
const REQUIRED = [
  "astral-zwj-sequence", "astral-letter",
  "astral-200", "astral-201", "ascii-200", "ascii-201", "emoji-100", "empty",
  ...[0x0000, 0x001f, 0x007f, 0x0080, 0x009f, 0x2028, 0x2029, 0x202a, 0x202e, 0x2066, 0x2069, 0x200b, 0x2060, 0xfeff, 0xe0000, 0xe007f].map((cp) => `refused-u${cp.toString(16).padStart(4, "0")}`),
  ...[0x0020, 0x00a0, 0x2027, 0x202f, 0x2065, 0x206a, 0x200a, 0x2061, 0xfefe, 0xe0080, 0xe0100].map((cp) => `allowed-u${cp.toString(16).padStart(4, "0")}`),
  "allowed-zwj", "allowed-zwnj-persian", "allowed-lrm", "allowed-rlm", "allowed-alm",
  "allowed-hebrew", "allowed-arabic", "allowed-accents", "allowed-cjk",
];

test("the parity fixture is complete and well formed: every required id, unique ids, one string per case, ASCII-only file", () => {
  const ids = cases.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const id of REQUIRED) assert.ok(ids.includes(id), `the fixture keeps ${id}`);
  for (const c of cases) {
    assert.equal(typeof c.valid, "boolean", c.id);
    assert.equal(typeof c.why, "string", c.id);
    assert.ok((typeof c.text === "string") !== (typeof c.unit === "string" && Number.isInteger(c.repeat) && c.repeat > 0), `${c.id}: text, or unit and repeat`);
  }
  assert.doesNotMatch(readFileSync(FIXTURE, "utf8"), /[^\x20-\x7e\n]/, "non-ASCII is written as JSON escapes");
  // The length cases count code points, not UTF-16 units.
  const byId = Object.fromEntries(cases.map((c) => [c.id, textOf(c)]));
  assert.equal([...byId["astral-200"]].length, 200); assert.equal(byId["astral-200"].length, 400);
  assert.equal([...byId["emoji-100"]].length, 100); assert.equal(byId["emoji-100"].length, 200);
});

test("kernel parity: validWaitingMessage gives every fixture case its `valid`", () => {
  for (const c of cases) assert.equal(validWaitingMessage(textOf(c)), c.valid, `${c.id}: ${c.why}`);
});
