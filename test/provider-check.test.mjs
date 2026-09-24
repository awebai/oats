// lib/instance-inspect.mjs — the readiness `providers` relay (lead decisions on #162):
// the provider's check answer is relayed verbatim as {status, problems, warnings};
// optional warnings never change the status and are validated as strictly as
// problems; the check executable must stay inside its module (realpath containment).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readinessDocument, runProviderCheck } from "../lib/instance-inspect.mjs";

/** A home target with one bound provider module whose check prints `answer`. */
function target(base, answer, { script = "bin/check.mjs" } = {}) {
  const home = join(base, "home"), dir = join(home, ".oats", "modules", "fx.provider");
  mkdirSync(join(dir, "bin"), { recursive: true });
  const manifest = { capability: "fx.provider", version: "1.0.0", layer: "messaging", commands: { "binding-check": script }, binding: { version: 1, check: "binding-check" } };
  writeFileSync(join(dir, "oats.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "bin", "check.mjs"), `process.stdout.write(${JSON.stringify(JSON.stringify(answer))} + "\\n");\n`);
  const mod = { name: "fx.provider", from: null, manifest, dir };
  const t = { kind: "instance", home, meta: { instance: "fx-1", agent: "fx" }, deployment: base, agentsRoot: join(base, "agents"),
    subject: { kind: "instance", instance: "fx-1", home, soul: "fx" },
    soul: { name: "fx", repoKey: null, commit: null, team: null, external: true, path: null, soulDir: null, definition: null, problems: [] },
    workspace: { key: null, name: null, deployment: base, commit: null, standalone: false },
    modules: [mod], payloads: {}, slots: { knowledge: null, messaging: "fx.provider", tasks: null }, discovery: null, discoveryError: null, resolutionError: null, lock: null, prepared: null };
  return { t, mod, dir };
}
const envelope = (result) => ({ schemaVersion: 1, phase: "check", slot: "messaging", capability: "fx.provider", ok: true, result });

test("a ready check with a warning passes, and the warning is relayed verbatim", async () => {
  const base = mkdtempSync(join(tmpdir(), "oats-provider-check-"));
  try {
    const warning = { code: "e2ee-disabled", message: "end-to-end encryption is disabled for this team" };
    const { t } = target(base, envelope({ status: "ready", problems: [], warnings: [warning] }));
    const rd = await readinessDocument(t);
    const item = rd.checks.providers.items[0];
    assert.equal(item.status, "pass");
    assert.deepEqual(item.result, { status: "ready", problems: [], warnings: [warning] });
    assert.equal(item.reason, null, "a warning is not a failure reason");
    assert.equal(rd.summary.ready, true, "warnings never change readiness");
    assert.equal(rd.summary.fail + rd.summary.unknown, 0);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("absent warnings read as []; malformed warnings make the whole answer unknown", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-provider-check-"));
  try {
    let { t, mod, dir } = target(join(base, "a"), envelope({ status: "needs-configuration", problems: [{ code: "needs-configuration", message: "x" }] }));
    assert.deepEqual(runProviderCheck(t, mod, dir), { outcome: "result", result: { status: "needs-configuration", problems: [{ code: "needs-configuration", message: "x" }], warnings: [] } });
    for (const [i, warnings] of [[{ code: "w" }], "e2ee off", [{ code: 1, message: "m" }]].entries()) {
      ({ t, mod, dir } = target(join(base, `bad${i}`), envelope({ status: "ready", problems: [], warnings })));
      const out = runProviderCheck(t, mod, dir);
      assert.equal(out.outcome, "unknown", JSON.stringify(warnings));
      assert.equal(out.problems[0].code, "provider-unavailable");
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("a check executable that symlinks out of its module is not run", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-provider-check-"));
  try {
    const outside = join(base, "outside.mjs");
    writeFileSync(outside, `process.stdout.write(${JSON.stringify(JSON.stringify(envelope({ status: "ready", problems: [] })))} + "\\n");\n`);
    const { t, mod, dir } = target(base, envelope({ status: "ready", problems: [] }), { script: "bin/escape.mjs" });
    symlinkSync(outside, join(dir, "bin", "escape.mjs"));
    const out = runProviderCheck(t, mod, dir);
    assert.equal(out.outcome, "unknown");
    assert.equal(out.problems[0].code, "resource-not-found");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
