// oats.aweb 1.10.0 hook behaviour, against a fake `aw` on PATH: session
// delivery output, the honest retire report, and the retired-alias remedy.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
if (a.startsWith("workspace connect")) process.exit(0);
if (a.startsWith("check --online")) process.exit(0);
if (a.startsWith("heartbeat")) process.exit(0);
if (a.startsWith("workspace status")) { const mode = process.env.FAKE_STATUS || "ok"; console.log(JSON.stringify(mode === "ok" ? { alias: "merlin", workspace_path: process.cwd(), hostname: require("node:os").hostname() } : { alias: "merlin", workspace_path: "/somewhere/else", hostname: "other" })); process.exit(0); }
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

function legacySeat(base) {
  const legacy = join(base, "legacy-home"); const src = join(legacy, ".aw");
  write(join(src, "signing.key"), "PRIVATE-KEY-BYTES\n");
  write(join(src, "identity.yaml"), "did: did:aw:WJ5Q2fnu\naddress: cjr.aweb.ai/merlin\ncustody: self\n");
  write(join(src, "teams.yaml"), "active_team: t:example.test\nmemberships:\n  - team_id: t:example.test\n");
  write(join(src, "team-certs", "t-example.test.pem"), "CERT\n");
  write(join(src, "encryption.yaml"), "assertion: x\n");
  write(join(src, "encryption-keys", "x25519.key"), "ENC-KEY\n");
  write(join(src, "workspace.yaml"), "aweb_url: https://app.example.test\napi_key: SECRET-API-KEY\nrole_name: coordinator\nworkspace_path: /legacy\n");
  write(join(src, "context"), "cache\n");
  write(join(src, "interaction-log.jsonl"), "{}\n");
  return { legacy, src };
}

test("retained identity: authority files copied exactly, coordination reconnected, lock beside the source, brief names the seat; never workspace.yaml or caches", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-110-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const { src } = legacySeat(base);
    const env = { OATS_INSTANCE: "merlin-seat", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_RUNTIME: "claude", OATS_TEAM_ID: "t:example.test", OATS_SETTINGS: JSON.stringify({ identity: { source: src } }) };
    const r = runHook(base, bin, "spawn", env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.doc.meta.retained, true); assert.equal(r.doc.meta.alias, "merlin"); assert.equal(r.doc.meta.team, "t:example.test");
    assert.match(r.doc.brief, /retained seat of the existing aweb identity "merlin" on team t:example.test/);
    const dest = join(home, ".aw");
    for (const f of ["signing.key", "identity.yaml", "teams.yaml", "team-certs/t-example.test.pem", "encryption.yaml", "encryption-keys/x25519.key"]) assert.equal(existsSync(join(dest, f)), true, `${f} copied`);
    assert.equal((statSync(join(dest, "signing.key")).mode & 0o777), 0o600, "key material is 0600");
    assert.equal((statSync(dest).mode & 0o777), 0o700, ".aw is 0700");
    for (const f of ["workspace.yaml", "context", "interaction-log.jsonl"]) assert.equal(existsSync(join(dest, f)), false, `${f} never copied`);
    const log = readFileSync(join(base, "aw.log"), "utf8");
    assert.match(log, /^workspace connect --service https:\/\/app\.example\.test --team t:example\.test --role coordinator$/m, "connect with the source's service, the team, and the source's role, nothing else");
    assert.equal(log.includes("team join"), false, "a retained seat is never minted");
    assert.equal(log.includes("SECRET-API-KEY"), false);
    assert.match(log, /workspace connect[\s\S]*check --online[\s\S]*heartbeat[\s\S]*workspace status/, "connect, check, heartbeat, status, in that order");
    const lock = JSON.parse(readFileSync(join(base, "legacy-home", ".aw-retained-seat.json"), "utf8"));
    assert.equal(lock.home, home); assert.equal(lock.alias, "merlin"); assert.equal(lock.team, "t:example.test");
    // A second seat cannot take a live holder's identity.
    writeFileSync(join(base, "legacy-home", ".aw-retained-seat.json"), JSON.stringify({ ...lock, pid: process.pid }));
    const home2 = join(root, "agents", "dev", "instances", "merlin-seat-2"); mkdirSync(home2, { recursive: true });
    const second = runHook(base, bin, "spawn", { ...env, OATS_INSTANCE: "merlin-seat-2", OATS_HOME: home2 });
    assert.notEqual(second.status, 0);
    assert.match(second.stdout, /already held by /);
    assert.equal(existsSync(join(home2, ".aw")), false, "nothing copied for the refused seat");
    // Retire releases the lock and touches nothing else: no workspace delete.
    const before = readFileSync(join(base, "aw.log"), "utf8");
    const ret = runHook(base, bin, "retire", { OATS_INSTANCE: "merlin-seat", OATS_HOME: home, OATS_META: JSON.stringify(r.doc.meta) });
    assert.equal(ret.status, 0, ret.stdout + ret.stderr);
    assert.deepEqual(ret.doc.meta, { retired: true, retained: true, identityReleased: true });
    assert.equal(existsSync(join(base, "legacy-home", ".aw-retained-seat.json")), false, "lock released");
    assert.equal(readFileSync(join(base, "aw.log"), "utf8"), before, "retire ran no aw command at all");
    assert.equal(existsSync(join(src, "signing.key")), true, "the source identity is untouched");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("retained identity: a status that does not show the new path fails the spawn and rolls back the copied material and the lock", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-110-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const { src } = legacySeat(base);
    const r = runHook(base, bin, "spawn", { OATS_INSTANCE: "merlin-seat", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_RUNTIME: "pi", OATS_TEAM_ID: "t:example.test", OATS_SETTINGS: JSON.stringify({ identity: { source: src } }), FAKE_STATUS: "elsewhere" });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /retained identity could not be seated from /);
    assert.equal(existsSync(join(home, ".aw")), false, "copied material removed");
    assert.equal(existsSync(join(base, "legacy-home", ".aw-retained-seat.json")), false, "lock released");
    assert.equal(existsSync(join(src, "signing.key")), true, "source untouched");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
