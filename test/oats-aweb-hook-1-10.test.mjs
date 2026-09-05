// oats.aweb 1.10.0 hook behaviour, against a fake `aw` on PATH: session
// delivery output, the honest retire report, and the retired-alias remedy.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const HOOK = resolve(new URL("../capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

/** A fake aw: team list/invite/join/init/workspace delete answer as the real
 *  one does, from a script the test controls (JOIN_MODE selects the join
 *  answer). */
function fakeAw(base, joinMode = "ok") {
  const bin = join(base, "bin"); mkdirSync(bin, { recursive: true });
  write(join(bin, "aw"), `#!/usr/bin/env node
const a = process.argv.slice(2).join(" ");
const log = ${JSON.stringify(join(base, "aw.log"))};
require("node:fs").appendFileSync(log, a + "\\n");
if (a.startsWith("team list")) { console.log(JSON.stringify({ active_team: "t:example.test", memberships: [{ team_id: "t:example.test" }] })); process.exit(0); }
if (a.startsWith("team invite")) { console.log(JSON.stringify({ token: "TOK-secret" })); process.exit(0); }
if (a.startsWith("team join")) {
  if (${JSON.stringify(joinMode)} === "conflict") { console.error("aweb: http 422: alias already holds an active certificate for this team"); process.exit(1); }
  console.log(JSON.stringify({ alias: "probe", team_id: "t:example.test" })); process.exit(0);
}
if (a.startsWith("init")) process.exit(0);
if (a.startsWith("workspace delete")) process.exit(0);
console.error("fake aw: unexpected " + a); process.exit(2);
`);
  chmodSync(join(bin, "aw"), 0o755);
  return bin;
}

function deployment(base) {
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  write(join(root, ".aw", "workspace.yaml"), "aweb_url: https://example.test\n");
  const home = join(root, "agents", "dev", "instances", "probe"); mkdirSync(home, { recursive: true });
  return { root, home };
}

function runHook(base, bin, event, env) {
  const r = spawnSync(process.execPath, [HOOK, event], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OATS_EVENT: event, ...env } });
  let doc; try { doc = JSON.parse(r.stdout.trim()); } catch { doc = undefined; }
  return { ...r, doc };
}

test("spawn with delivery=session: AWEB_DELIVERY in the launch env, no Claude channel flag, and a brief that says nothing wakes the instance", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-110-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base);
    const env = { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_RUNTIME: "claude", OATS_TEAM_ID: "t:example.test" };
    const channel = runHook(base, bin, "spawn", { ...env, OATS_SETTINGS: JSON.stringify({}) });
    assert.equal(channel.status, 0, channel.stdout + channel.stderr);
    assert.equal(channel.doc.meta.delivery, "channel");
    assert.match(channel.doc.launch?.claude || "", /aweb-channel@awebai-marketplace/);
    assert.equal(channel.doc.env, undefined);
    const session = runHook(base, bin, "spawn", { ...env, OATS_SETTINGS: JSON.stringify({ delivery: "session" }) });
    assert.equal(session.status, 0, session.stdout + session.stderr);
    assert.equal(session.doc.meta.delivery, "session");
    assert.deepEqual(session.doc.env, { AWEB_DELIVERY: "session" });
    assert.equal(session.doc.launch, undefined, "no channel flag in session mode");
    assert.match(session.doc.brief, /Notification delivery: external \(AWEB_DELIVERY=session\)/);
    assert.match(session.doc.brief, /NOTHING wakes you/);
    // An unknown value behaves as channel, never as session.
    const odd = runHook(base, bin, "spawn", { ...env, OATS_SETTINGS: JSON.stringify({ delivery: "broker" }) });
    assert.equal(odd.doc.meta.delivery, "channel");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("retire: workspace deleted is reported as retired with aliasReusable false and a warning naming aweb-abim and the remedy", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-110-"));
  try {
    const bin = fakeAw(base); const { home } = deployment(base);
    mkdirSync(join(home, ".aw"), { recursive: true });
    const r = runHook(base, bin, "retire", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_META: JSON.stringify({ alias: "probe", team: "t:example.test" }) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.doc.meta, { retired: true, aliasReusable: false });
    assert.match(r.doc.warning, /certificate is not revoked \(aweb-abim\).*fresh --purpose/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("spawn: a join refused because the alias still holds a certificate is fatal with the retired-alias explanation and the fresh-purpose remedy", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-110-"));
  try {
    const bin = fakeAw(base, "conflict"); const { root, home } = deployment(base);
    const r = runHook(base, bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_RUNTIME: "pi", OATS_TEAM_ID: "t:example.test", OATS_SETTINGS: "{}" });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /already holds a certificate on t:example.test .*not reusable until aweb-abim.*fresh --purpose/);
    assert.equal(r.stdout.includes("TOK-secret"), false, "the invite token never reaches the log");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
