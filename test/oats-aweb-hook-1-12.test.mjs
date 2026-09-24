// oats.aweb 1.12.0 hook behaviour, against a fake `aw` on PATH:
// local/global identity meta, resident session grants, compensation, and revoke.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const HOOK = resolve(new URL("../capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

function fakeAw(base) {
  const bin = join(base, "bin"); mkdirSync(bin, { recursive: true });
  write(join(bin, "aw"), `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const a = process.argv.slice(2);
const s = a.join(" ");
const log = ${JSON.stringify(join(base, "aw.log"))};
const j = (obj) => JSON.stringify(obj, null, 2);
fs.appendFileSync(log, JSON.stringify({ argv: a, cwd: process.cwd(), identityHome: process.env.AWEB_IDENTITY_HOME || null }) + "\\n");
const grantCmd = a[0] === "--identity-home" ? a.slice(2) : a;
if (grantCmd[0] === "id" && grantCmd[1] === "grant" && (a[0] === "--identity-home" || process.env.AWEB_IDENTITY_HOME)) {
  console.error('command "aw ' + grantCmd.slice(0, 3).join(' ') + '" is not yet identity-home-aware; refusing to use an external identity home');
  process.exit(2);
}
const cmd = a;
function val(flag) { const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : undefined; }
if (s === "version") { console.log("aw 1.36.1"); process.exit(0); }
if (s.startsWith("wake ")) { if (process.env.FAKE_NO_WAKE) { console.error("aw: unknown command wake"); process.exit(2); } process.exit(0); }
if (s === "custody status --json") { console.log(j({ status: "running", service_id: "custody-fake-4c353d6d", socket_path: path.join(process.cwd(), "custody.sock"), resident: { did_aw: "did:aw:resident", did_key: "did:key:resident", address: "oats.aweb.ai/resident-alias", alias: "resident-alias" }, teams: [{ team_id: process.env.FAKE_CUSTODY_TEAM || "t:example.test", ready: true, certificate_present: true, grant_status_endpoint_ready: true }], keys: { signing_ready: true, encryption_ready: true, encryption_key_id: "enc-1" }, ops: ["sign_plain_message.v1", "create_e2ee_envelope.v1", "unwrap_e2ee_message.v1", "status.v1"], freshness: { source: "fake", last_checked_at: "2026-09-24T00:00:00Z", max_cache_age_seconds: 30 }, errors: [] })); process.exit(0); }
if (s.startsWith("team list")) { console.log(j({ active_team: "t:example.test", memberships: [{ team_id: "t:example.test" }] })); process.exit(0); }
if (s.startsWith("team invite")) { console.log(j({ token: "TOK-secret" })); process.exit(0); }
if (s.startsWith("team join")) { console.log(j({ alias: "probe", team_id: "t:example.test" })); process.exit(0); }
if (s.startsWith("init")) process.exit(0);
if (s.startsWith("workspace delete")) { console.log(j({ alias_released: true, alias_released_reason: "revoked" })); process.exit(0); }
if (cmd[0] === "id" && cmd[1] === "grant" && cmd[2] === "mint") {
  const out = val("--out");
  if (!out) { console.error("missing --out"); process.exit(2); }
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(out, "grant.yaml"), "version: 1\\ngrant_id: grant-123\\nteam_id: " + (process.env.FAKE_GRANT_TEAM || "t:example.test") + "\\nexpires_at: 2026-09-24T07:00:00Z\\n");
  console.log("progress: minted");
  if (process.env.FAKE_MINT_NO_JSON) process.exit(0);
  console.log(j({ grant_id: "grant-123", expires_at: "2026-09-24T07:00:00Z", team_id: process.env.FAKE_GRANT_TEAM || "t:example.test", alias: "resident-alias", address: process.env.FAKE_GRANT_ADDRESS || "oats.aweb.ai/resident-alias", out }));
  process.exit(0);
}
if (cmd[0] === "id" && cmd[1] === "grant" && cmd[2] === "revoke") {
  if (process.env.FAKE_REVOKE_MAYBE_APPLIED) { console.error("context deadline exceeded; request may have applied"); process.exit(1); }
  if (process.env.FAKE_REVOKE_FAIL) { console.error("revoke unavailable"); process.exit(1); }
  console.log(j({ grant_id: cmd[3], status: "revoked" }));
  process.exit(0);
}
if (cmd[0] === "id" && cmd[1] === "grant" && cmd[2] === "show") {
  console.log(j({ grant_id: cmd[3], status: process.env.FAKE_SHOW_STATUS || "active" }));
  process.exit(0);
}
console.error("fake aw: unexpected " + s); process.exit(2);
`);
  chmodSync(join(bin, "aw"), 0o755);
  return bin;
}

function deployment(base) {
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "probe"); mkdirSync(home, { recursive: true });
  return { root, home };
}

function resident(base, name = "merlin") {
  const custody = join(base, "custody", name);
  write(join(custody, ".aw", "identity.yaml"), "alias: resident-alias\n");
  return custody;
}

function runHook(bin, event, env) {
  const r = spawnSync(process.execPath, [HOOK, event], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OATS_EVENT: event, ...env } });
  let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
  return { ...r, doc };
}

function logLines(base) {
  return readFileSync(join(base, "aw.log"), "utf8").trim().split(/\n/).filter(Boolean).map((l) => JSON.parse(l));
}

test("local mode keeps existing behaviour and adds messaging-layer meta.identity", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-112-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base);
    const r = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_TEAM_ID: "t:example.test", OATS_SETTINGS: JSON.stringify({}) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.doc.meta.alias, "probe");
    assert.equal(r.doc.meta.team, "t:example.test");
    assert.equal(r.doc.meta.delivery, "channel");
    assert.deepEqual(r.doc.meta.identity, { mode: "local", alias: "probe", team: "t:example.test", address: null, resident: null });
    assert.equal(r.doc.env, undefined);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("global mode requires a named resident resolved from host settings and names the oats-local.yaml key", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-112-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base);
    let r = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify({ team: "t:example.test", identity: { mode: "global" }, residents: {} }) });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /identity\.resident/);
    assert.match(r.stdout, /oats-local\.yaml settings\.oats\.aweb\.residents\.<name>/);
    r = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify({ team: "t:example.test", identity: { mode: "global", resident: "merlin" }, residents: {} }) });
    assert.notEqual(r.status, 0);
    assert.match(r.doc.warning, /resident "merlin"/);
    assert.match(r.doc.warning, /oats-local\.yaml settings\.oats\.aweb\.residents\.merlin/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("global mode rejects identity.source because source belongs to retained-seat local mode", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-112-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const custody = resident(base);
    const r = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify({ team: "t:example.test", identity: { mode: "global", source: join(custody, ".aw"), resident: "merlin" }, residents: { merlin: custody } }) });
    assert.notEqual(r.status, 0);
    assert.match(r.doc.warning, /identity\.mode.*global/);
    assert.match(r.doc.warning, /identity\.source/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("global mode mints a grant from custody, returns AWEB_IDENTITY_HOME and identity meta, and registers session delivery", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-112-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const custody = resident(base);
    const r = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_TEAM_ID: "", OATS_TEAM_NAME: "", OATS_SETTINGS: JSON.stringify({ team: "t:example.test", delivery: "session", identity: { mode: "global", resident: "merlin", scopes: ["mail.read", "chat.send"], ttl: "90m" }, residents: { merlin: custody } }), AWEB_IDENTITY_HOME: join(base, "ambient-grant-home") });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.doc.env, { AWEB_DELIVERY: "session", AWEB_IDENTITY_HOME: join(home, ".aweb-identity") });
    assert.deepEqual(r.doc.meta.identity, { mode: "global", alias: "resident-alias", team: "t:example.test", address: "oats.aweb.ai/resident-alias", resident: "merlin", grant: { id: "grant-123", expiresAt: "2026-09-24T07:00:00Z", scopes: ["mail.read", "chat.send"], home: join(home, ".aweb-identity") } });
    assert.equal(r.doc.meta.delivery, "session");
    assert.match(r.doc.brief, /act as resident aweb identity "resident-alias"/);
    assert.match(r.doc.brief, /mail\.read, chat\.send/);
    assert.match(r.doc.brief, /2026-09-24T07:00:00Z/);
    assert.match(r.doc.brief, /identity lifecycle commands are not yours to run/);
    assert.equal(existsSync(join(home, ".aweb-identity", "grant.yaml")), true);
    const lines = logLines(base);
    const mint = lines.find((l) => l.argv.join(" ").includes("id grant mint"));
    assert.deepEqual(mint.argv, ["id", "grant", "mint", "--scope", "mail.read,chat.send", "--ttl", "90m", "--label", "oats:probe", "--out", join(home, ".aweb-identity"), "--json"]);
    assert.equal(mint.cwd, realpathSync(custody));
    assert.equal(mint.identityHome, null);
    const wake = lines.find((l) => l.argv[0] === "wake" && l.argv[1] === "register");
    assert.deepEqual(wake.argv, ["wake", "register", "--home", home, "--identity-home", join(home, ".aweb-identity"), "--delivery", "session"]);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("global mode revokes and removes the grant when the minted team differs from the payload team", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-112-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const custody = resident(base);
    const r = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify({ team: "expected:team", identity: { mode: "global", resident: "merlin" }, residents: { merlin: custody } }), FAKE_CUSTODY_TEAM: "expected:team", FAKE_GRANT_TEAM: "wrong:team" });
    assert.notEqual(r.status, 0);
    assert.equal(existsSync(join(home, ".aweb-identity")), false, "mismatched grant home removed after revoke");
    assert.equal(r.doc.meta.identity.grant.id, "grant-123", "meta is still emitted for idempotent retire compensation");
    assert.match(r.doc.warning, /minted grant team wrong:team differs from expected:team/);
    const revoke = logLines(base).find((l) => l.argv.join(" ").includes("id grant revoke"));
    assert.deepEqual(revoke.argv, ["id", "grant", "revoke", "grant-123", "--json"]);
    assert.equal(revoke.cwd, realpathSync(custody));
    assert.equal(revoke.identityHome, null);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("global mode compensates if wake registration fails after mint", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-112-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const custody = resident(base);
    const r = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify({ team: "t:example.test", delivery: "session", identity: { mode: "global", resident: "merlin" }, residents: { merlin: custody } }), FAKE_NO_WAKE: "1" });
    assert.notEqual(r.status, 0);
    assert.equal(r.doc.meta.identity.grant.id, "grant-123");
    assert.equal(existsSync(join(home, ".aweb-identity")), false, "grant home removed after wake registration failure");
    const revoke = logLines(base).find((l) => l.argv.join(" ").includes("id grant revoke"));
    assert.ok(revoke, "minted grant revoked during compensation");
    assert.match(r.doc.warning, /wake register/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("global mode compensates when mint writes a grant home but prints no JSON", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-112-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const custody = resident(base);
    const r = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify({ team: "t:example.test", identity: { mode: "global", resident: "merlin" }, residents: { merlin: custody } }), FAKE_MINT_NO_JSON: "1" });
    assert.notEqual(r.status, 0);
    assert.equal(r.doc.meta.identity.grant.id, "grant-123");
    assert.equal(existsSync(join(home, ".aweb-identity")), false, "grant home removed after malformed mint output");
    assert.ok(logLines(base).some((l) => l.argv.join(" ").includes("id grant revoke grant-123")), "grant revoked despite missing JSON output");
    assert.match(r.doc.warning, /returned no JSON/);
    assert.match(r.doc.warning, /revoked it/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("global mode reports a failed recovery revoke truthfully while keeping grant meta", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-112-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const custody = resident(base);
    const r = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify({ team: "t:example.test", identity: { mode: "global", resident: "merlin" }, residents: { merlin: custody } }), FAKE_MINT_NO_JSON: "1", FAKE_REVOKE_FAIL: "1" });
    assert.notEqual(r.status, 0);
    assert.equal(r.doc.meta.identity.grant.id, "grant-123", "meta kept for retire compensation retry");
    assert.equal(existsSync(join(home, ".aweb-identity")), false, "grant home removed even when revoke failed");
    assert.match(r.doc.warning, /revoke failed: .*revoke unavailable/);
    assert.doesNotMatch(r.doc.warning, /revoked it/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("global retire revokes the grant through custody and deregisters session delivery", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-112-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const custody = resident(base);
    const meta = { delivery: "session", identity: { mode: "global", alias: "resident-alias", team: "t:example.test", address: null, resident: "merlin", grant: { id: "grant-123", expiresAt: "2026-09-24T07:00:00Z", scopes: ["mail.read"] } } };
    const r = runHook(bin, "retire", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_META: JSON.stringify(meta), OATS_SETTINGS: JSON.stringify({ residents: { merlin: custody } }), AWEB_IDENTITY_HOME: join(home, ".aweb-identity") });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.doc.meta.identityRevoked, true);
    const lines = logLines(base);
    const revoke = lines.find((l) => l.argv.join(" ") === ["id", "grant", "revoke", "grant-123", "--json"].join(" "));
    assert.ok(revoke);
    assert.equal(revoke.cwd, realpathSync(custody));
    assert.equal(revoke.identityHome, null);
    assert.ok(lines.some((l) => l.argv.join(" ") === ["wake", "deregister", "--home", home].join(" ")));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("global retire treats a maybe-applied revoke timeout as success when grant show says revoked", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-112-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const custody = resident(base);
    const meta = { identity: { mode: "global", resident: "merlin", grant: { id: "grant-123", expiresAt: "2026-09-24T07:00:00Z", scopes: [] } } };
    const r = runHook(bin, "retire", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_META: JSON.stringify(meta), OATS_SETTINGS: JSON.stringify({ residents: { merlin: custody } }), FAKE_REVOKE_MAYBE_APPLIED: "1", FAKE_SHOW_STATUS: "revoked" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.doc.meta.identityRevoked, true);
    const lines = logLines(base);
    assert.ok(lines.some((l) => l.argv.join(" ") === "id grant revoke grant-123 --json"));
    assert.ok(lines.some((l) => l.argv.join(" ") === "id grant show grant-123 --json"));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("global retire reports nothing to revoke without a grant id and fails loudly when revoke fails", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-112-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const custody = resident(base);
    let r = runHook(bin, "retire", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_META: JSON.stringify({ identity: { mode: "global", resident: "merlin" } }), OATS_SETTINGS: JSON.stringify({ residents: { merlin: custody } }) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.doc.meta.reason, "nothing-to-revoke");
    r = runHook(bin, "retire", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_META: JSON.stringify({ identity: { mode: "global", resident: "merlin", grant: { id: "grant-123", expiresAt: "2026-09-24T07:00:00Z", scopes: [] } } }), OATS_SETTINGS: JSON.stringify({ residents: { merlin: custody } }), FAKE_REVOKE_FAIL: "1" });
    assert.notEqual(r.status, 0);
    assert.match(r.doc.warning, /grant grant-123 was not revoked/);
    assert.match(r.doc.warning, /expires at 2026-09-24T07:00:00Z/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
