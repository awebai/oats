// A session command's refusal names the file it could not read (awebai/oats#1092).
//
// Session control reads two files of a home: its session receipt and its record (instance.json).
// They were read in one `try`, and its `catch` called every failure the receipt's; a parser's
// message holds no path, so for a record that is not JSON nothing in the sentence named the right
// file. Each is now read on its own, and each failure names its own file by its path. The code is
// E_RUNTIME_ENDPOINT_UNKNOWN for either, as before.
//
// The fixture is a home spawned without a launch: its receipt records no session, so the commands
// read both files and need no tmux server.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

function home(t) {
  const fx = v2Deployment({ t });
  const r = fx.cli(["spawn", "dev", "--name", "dev-files", "--harness", "pi", "--no-launch", "--json"]);
  const spawned = JSON.parse(r.stdout);
  assert.equal(spawned.ok, true, `fixture premise: ${r.stdout}${r.stderr}`);
  const at = realpathSync(spawned.result.home);
  const baselines = join(dirname(at), ".oats-retirement", "baselines");
  const receipts = readdirSync(baselines).filter((f) => f.endsWith(".json"));
  assert.equal(receipts.length, 1, `fixture premise: one session receipt (${receipts})`);
  return { fx, home: at, record: join(at, "instance.json"), receipt: join(baselines, receipts[0]) };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// What `session inspect --json` and `session inspect` in text mode answer for the home.
function answers(h) {
  const json = h.fx.cli(["session", "inspect", "--home", h.home, "--json"]);
  const text = h.fx.cli(["session", "inspect", "--home", h.home]);
  const envelope = JSON.parse(json.stdout);
  assert.deepEqual([json.status, envelope.ok, envelope.error?.code], [1, false, "E_RUNTIME_ENDPOINT_UNKNOWN"], json.stdout);
  assert.equal(text.status, 1, text.stdout + text.stderr);
  assert.equal(text.stderr.trim(), `oats: ${envelope.error.message}`, "text mode prints the same sentence");
  return envelope.error.message;
}

test("a session command refused for a record that is not JSON names the record by its path and not the receipt; one refused for a missing record says it is missing, by its path; the code is E_RUNTIME_ENDPOINT_UNKNOWN (#1092)", (t) => {
  const h = home(t);
  writeFileSync(h.record, "{ not json");
  const unparsable = answers(h);
  assert.match(unparsable, new RegExp(`^cannot read ${esc(h.record)}: Expected property name`), unparsable);
  assert.doesNotMatch(unparsable, /receipt/);
  assert.ok(!unparsable.includes(h.receipt), unparsable);

  rmSync(h.record);
  const missing = answers(h);
  assert.equal(missing, `cannot read ${h.record}: it is missing`);
});

test("a session command refused for a receipt that is not JSON names the receipt by its path and not the record (#1092)", (t) => {
  const h = home(t);
  writeFileSync(h.receipt, "{ not json");
  const message = answers(h);
  assert.match(message, new RegExp(`^cannot read session receipt for ${esc(h.home)} at ${esc(h.receipt)}: Expected property name`), message);
  assert.ok(!message.includes("instance.json"), message);
});
