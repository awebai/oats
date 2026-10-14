// The harness-package gate has one name, E_HARNESS_RESOURCE_MISSING (awebai/oats#1047).
//
// A spawn calls the gate itself and answers its code. A start, a restart and a launch plan's
// preview reach it through planLaunch's `harness-packages` check, which named whatever the gate
// threw E_HARNESS_PACKAGE: one refusal with one sentence had two codes a client could see. The
// check now fails with the gate's own code, and anything else the gate throws is a fault, not a
// missing package: it is thrown on, and the command's door answers it.
//
// The fixture is a home spawned on a harness for which nothing is required (pi), started on one
// whose package a capability requires and which is not installed (claude).
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const GATE = /^this instance runs on claude, and its active capabilities require harness packages that are not installed:\n {2}test\.chat requires the claude package chat@acme-market/;

function deployment(t) {
  const fx = v2Deployment({ t,
    souls: { dev: { soul: { capabilities: { "test.chat": { from: "here" } } } } },
    capabilities: { "test.chat": { manifest: { requires: [{ harness: "claude", package: "chat@acme-market", why: "the fixture's" }] } } },
  });
  const envelope = (r) => { try { return JSON.parse(r.stdout); } catch { assert.fail(`no envelope: ${r.stdout}${r.stderr}`); } };
  const spawned = envelope(fx.cli(["spawn", "dev", "--name", "dev-gate", "--harness", "pi", "--no-launch", "--json"]));
  assert.equal(spawned.ok, true, `fixture premise: nothing is required on pi: ${JSON.stringify(spawned.error)}`);
  return { fx, envelope, home: spawned.result.home };
}

test("a start and a restart refused by the harness-package gate answer E_HARNESS_RESOURCE_MISSING at the top, with the gate's sentence, and a launch plan's preview shows the check's row with that code; E_HARNESS_PACKAGE is no longer answered (#1047)", (t) => {
  const d = deployment(t);
  for (const verb of ["start", "restart"]) {
    const r = d.fx.cli(["session", verb, "--home", d.home, "--harness", "claude", "--json"]);
    const e = d.envelope(r);
    assert.deepEqual([r.status, e.ok, e.error?.code], [1, false, "E_HARNESS_RESOURCE_MISSING"], `${verb}: ${r.stdout}`);
    assert.match(e.error.message, GATE, verb);
  }
  const preview = d.envelope(d.fx.cli(["launch-config", "preview", "--home", d.home, "--harness", "claude", "--json"]));
  assert.equal(preview.ok, true, JSON.stringify(preview.error));
  assert.equal(preview.result.ok, false);
  const row = preview.result.preflight.find((c) => c.check === "harness-packages");
  assert.deepEqual({ ...row, detail: undefined }, { check: "harness-packages", ok: false, code: "E_HARNESS_RESOURCE_MISSING", detail: undefined });
  assert.match(row.detail, GATE);
  assert.doesNotMatch(JSON.stringify(preview), /E_HARNESS_PACKAGE/);
});

test("a fault of the gate is not a missing package: a Claude whose plugin list the gate cannot read is no row of the plan, and the start's door answers it as a fault, with its cause (#1047)", (t) => {
  const d = deployment(t);
  // A claude whose `plugin list --json` names a project-scoped plugin with a project path that is
  // no path: the gate fails on it with Node's own error, before any verdict on the package.
  const bin = join(d.fx.base, "faulty-claude");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), `#!/bin/sh\n[ "$1 $2 $3" = "plugin list --json" ] && { echo '[{"id":"chat@acme-market","scope":"project","projectPath":42}]'; exit 0; }\nexit 0\n`);
  chmodSync(join(bin, "claude"), 0o755);
  const env = { PATH: `${bin}:${d.fx.env.PATH}` };

  const preview = d.envelope(d.fx.cli(["launch-config", "preview", "--home", d.home, "--harness", "claude", "--json"], { env }));
  // The preview fails as a whole, with the fault's own message, where it showed a row that called
  // the fault a missing package. (What code that command's door gives a fault is its own.)
  assert.equal(preview.ok, false, `the preview fails as a whole: ${JSON.stringify(preview.result?.preflight)}`);
  assert.notEqual(preview.error.code, "E_HARNESS_RESOURCE_MISSING");
  assert.match(preview.error.message, /must be of type string/, JSON.stringify(preview.error));

  const r = d.fx.cli(["session", "start", "--home", d.home, "--harness", "claude", "--json"], { env });
  const e = d.envelope(r);
  // The session commands' general code, with the fault's own code as its cause.
  assert.deepEqual([r.status, e.ok, e.error?.code], [1, false, "E_SESSION_FAILED"], r.stdout);
  assert.deepEqual(e.error.details?.cause, { code: "ERR_INVALID_ARG_TYPE" }, JSON.stringify(e.error));
  assert.match(e.error.message, /must be of type string/);
  for (const out of [preview, e]) assert.doesNotMatch(JSON.stringify(out), /E_HARNESS_PACKAGE/);
});
