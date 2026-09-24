// oats.aweb 1.13.0 hook behaviour, against a fake `aw` on PATH:
// custody preflight, concrete grant scopes, team selector gating, launch renewal,
// and retirement cleanup for resident grants.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const HOOK = resolve(new URL("../capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const TEAM_FLAG_FLOOR = "9.9.9";
const NORMAL_SCOPES = ["mail.read", "mail.send", "chat.read", "chat.send", "events.read", "coord.read", "coord.write", "presence.write", "contacts.read", "contacts.write"];
const REVIEWER_SCOPES = ["mail.read", "chat.read", "events.read", "coord.read", "presence.write"];

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

function fakeAw(base) {
  const bin = join(base, "bin"); mkdirSync(bin, { recursive: true });
  write(join(bin, "aw"), `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const a = process.argv.slice(2);
const s = a.join(" ");
const log = ${JSON.stringify(join(base, "aw.log"))};
const floor = ${JSON.stringify(TEAM_FLAG_FLOOR)};
const j = (obj) => JSON.stringify(obj, null, 2);
function versionTuple(v) { return String(v || "0.0.0").replace(/^aw\\s+v?/, "").replace(/^v/, "").split(".").slice(0, 3).map(n => Number(n) || 0); }
function atLeast(v, f) { const A = versionTuple(v), B = versionTuple(f); for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] > B[i]; return true; }
function val(flag) { const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : undefined; }
function csv(name, fallback) { return String(process.env[name] || fallback).split(",").map(s => s.trim()).filter(Boolean); }
fs.appendFileSync(log, JSON.stringify({ argv: a, cwd: process.cwd(), identityHome: process.env.AWEB_IDENTITY_HOME || null }) + "\\n");
if (a[0] === "id" && a[1] === "grant" && process.env.AWEB_IDENTITY_HOME) { console.error("grant command refuses external identity home"); process.exit(2); }
if (s === "version") { console.log("aw " + (process.env.FAKE_AW_VERSION || "1.36.1")); process.exit(0); }
if (s.startsWith("wake ")) process.exit(0);
if (a[0] === "custody" && a[1] === "status" && a.includes("--json")) {
  const team = process.env.FAKE_CUSTODY_TEAM || "t:example.test";
  const doc = {
    status: process.env.FAKE_CUSTODY_STATUS || "running",
    service_id: "custody-fake-4c353d6d",
    socket_path: path.join(process.cwd(), "custody.sock"),
    resident: { did_aw: "did:aw:resident", did_key: "did:key:resident", address: "oats.aweb.ai/resident-alias", alias: "resident-alias" },
    teams: process.env.FAKE_CUSTODY_TEAMS ? JSON.parse(process.env.FAKE_CUSTODY_TEAMS) : [{ team_id: team, ready: process.env.FAKE_TEAM_READY !== "0", certificate_present: true, grant_status_endpoint_ready: true }],
    keys: { signing_ready: process.env.FAKE_SIGNING_READY !== "0", encryption_ready: process.env.FAKE_ENCRYPTION_READY !== "0", encryption_key_id: "enc-1" },
    ops: csv("FAKE_CUSTODY_OPS", "sign_plain_message.v1,create_e2ee_envelope.v1,unwrap_e2ee_message.v1,status.v1"),
    freshness: { source: "fake", last_checked_at: "2026-09-24T00:00:00Z", max_cache_age_seconds: 30 },
    errors: process.env.FAKE_CUSTODY_ERRORS ? JSON.parse(process.env.FAKE_CUSTODY_ERRORS) : []
  };
  console.log(j(doc)); process.exit(0);
}
if (a[0] === "id" && a[1] === "grant" && a[2] === "mint") {
  if (a.includes("--team") && !atLeast(process.env.FAKE_AW_VERSION || "1.36.1", floor)) { console.error("unknown flag: --team"); process.exit(2); }
  if (process.env.FAKE_MINT_FAIL) { console.error("mint unavailable"); process.exit(1); }
  const out = val("--out");
  if (!out) { console.error("missing --out"); process.exit(2); }
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const suffix = path.basename(out).replace(/^\\.aweb-identity-?/, "") || "spawn";
  const grant = "grant-" + suffix;
  const team = process.env.FAKE_GRANT_TEAM || val("--team") || "t:example.test";
  fs.writeFileSync(path.join(out, "grant.yaml"), "version: 1\\ngrant_id: " + grant + "\\nteam_id: " + team + "\\nexpires_at: 2026-09-24T07:00:00Z\\n");
  console.log(j({ grant_id: grant, expires_at: "2026-09-24T07:00:00Z", team_id: team, alias: "resident-alias", address: "oats.aweb.ai/resident-alias", out }));
  process.exit(0);
}
if (a[0] === "id" && a[1] === "grant" && a[2] === "revoke") {
  if (process.env.FAKE_REVOKE_FAIL) { console.error("revoke unavailable"); process.exit(1); }
  console.log(j({ grant_id: a[3], status: "revoked" })); process.exit(0);
}
if (a[0] === "id" && a[1] === "grant" && a[2] === "show") { console.log(j({ grant_id: a[3], status: "revoked" })); process.exit(0); }
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

function settings(custody, identity = {}) {
  return { team: "t:example.test", identity: { mode: "global", resident: "merlin", ...identity }, residents: { merlin: custody } };
}

function runHook(bin, event, env) {
  const r = spawnSync(process.execPath, [HOOK, event], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OATS_EVENT: event, ...env } });
  let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
  return { ...r, doc };
}

function logLines(base) {
  return readFileSync(join(base, "aw.log"), "utf8").trim().split(/\n/).filter(Boolean).map((l) => JSON.parse(l));
}

function spawnGrant(base, extraSettings = {}, extraEnv = {}) {
  const bin = fakeAw(base); const { root, home } = deployment(base); const custody = resident(base);
  const payload = { ...settings(custody), ...extraSettings, identity: { ...settings(custody).identity, ...(extraSettings.identity || {}) } };
  const r = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify(payload), ...extraEnv });
  return { bin, root, home, custody, r };
}

test("normal global grants use the 1.13 concrete default scopes and preflight custody before mint", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-113-"));
  try {
    const { home, custody, r } = spawnGrant(base);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.doc.meta.identity.grant.scopes, NORMAL_SCOPES);
    assert.equal(r.doc.meta.identity.grant.home, join(home, ".aweb-identity"));
    const lines = logLines(base);
    const statusIdx = lines.findIndex((l) => l.argv.join(" ") === "custody status --json");
    const mintIdx = lines.findIndex((l) => l.argv.slice(0, 3).join(" ") === "id grant mint");
    assert.ok(statusIdx >= 0 && mintIdx > statusIdx, "custody status runs before mint");
    const mint = lines[mintIdx];
    assert.equal(mint.cwd, realpathSync(custody));
    assert.equal(mint.identityHome, null);
    assert.equal(mint.argv[mint.argv.indexOf("--scope") + 1], NORMAL_SCOPES.join(","));
    assert.equal(mint.argv.includes("--team"), false, "placeholder floor keeps --team off for current aw");
    assert.equal(existsSync(join(home, ".aweb-identity", "grant.yaml")), true);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("reviewer profile narrows defaults, explicit scopes win, and unknown profiles are fatal", () => {
  let base = mkdtempSync(join(tmpdir(), "oats-aweb-113-"));
  try {
    let { r } = spawnGrant(base, { identity: { profile: "reviewer" } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.doc.meta.identity.grant.scopes, REVIEWER_SCOPES);
  } finally { rmSync(base, { recursive: true, force: true }); }
  base = mkdtempSync(join(tmpdir(), "oats-aweb-113-"));
  try {
    const explicit = ["mail.read", "contacts.read"];
    const { r } = spawnGrant(base, { identity: { profile: "reviewer", scopes: explicit } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.doc.meta.identity.grant.scopes, explicit);
  } finally { rmSync(base, { recursive: true, force: true }); }
  base = mkdtempSync(join(tmpdir(), "oats-aweb-113-"));
  try {
    const { r } = spawnGrant(base, { identity: { profile: "owner" } });
    assert.notEqual(r.status, 0);
    assert.match(r.doc.warning, /identity\.profile.*normal.*reviewer/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("custody preflight fails closed with typed status/error and serve remedy before mint", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-113-"));
  try {
    const { r } = spawnGrant(base, {}, { FAKE_CUSTODY_STATUS: "not_running", FAKE_CUSTODY_ERRORS: JSON.stringify(["daemon_down"]) });
    assert.notEqual(r.status, 0);
    assert.match(r.doc.warning, /custody.*not_running/);
    assert.match(r.doc.warning, /daemon_down/);
    assert.match(r.doc.warning, /start aw custody serve for merlin/);
    assert.equal(logLines(base).some((l) => l.argv.slice(0, 3).join(" ") === "id grant mint"), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("custody preflight requires e2ee operations by default; identity.e2ee false needs signing only and briefs a warning", () => {
  let base = mkdtempSync(join(tmpdir(), "oats-aweb-113-"));
  try {
    const { r } = spawnGrant(base, {}, { FAKE_CUSTODY_OPS: "sign_plain_message.v1,status.v1", FAKE_ENCRYPTION_READY: "0" });
    assert.notEqual(r.status, 0);
    assert.match(r.doc.warning, /create_e2ee_envelope\.v1/);
    assert.match(r.doc.warning, /start aw custody serve for merlin/);
  } finally { rmSync(base, { recursive: true, force: true }); }
  base = mkdtempSync(join(tmpdir(), "oats-aweb-113-"));
  try {
    const { r } = spawnGrant(base, { identity: { e2ee: false } }, { FAKE_CUSTODY_OPS: "sign_plain_message.v1,status.v1", FAKE_ENCRYPTION_READY: "0" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.doc.brief, /E2E encryption is disabled/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("grant mint passes --team only at the reviewed aw common-slice version floor", () => {
  let base = mkdtempSync(join(tmpdir(), "oats-aweb-113-"));
  try {
    const { r } = spawnGrant(base, {}, { FAKE_AW_VERSION: "1.36.1" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(logLines(base).find((l) => l.argv.slice(0, 3).join(" ") === "id grant mint").argv.includes("--team"), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
  base = mkdtempSync(join(tmpdir(), "oats-aweb-113-"));
  try {
    const { r } = spawnGrant(base, {}, { FAKE_AW_VERSION: TEAM_FLAG_FLOOR });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const mint = logLines(base).find((l) => l.argv.slice(0, 3).join(" ") === "id grant mint").argv;
    assert.equal(mint[mint.indexOf("--team") + 1], "t:example.test");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("launch with renewal off preserves the existing grant locator and session delivery env", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-113-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const custody = resident(base);
    const oldHome = join(home, ".aweb-identity"); mkdirSync(oldHome, { recursive: true });
    const old = { delivery: "session", identity: { mode: "global", alias: "resident-alias", team: "t:example.test", resident: "merlin", grant: { id: "grant-old", expiresAt: "old", scopes: ["mail.read"] } } };
    const r = runHook(bin, "launch", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_META: JSON.stringify(old), OATS_SETTINGS: JSON.stringify(settings(custody)), AWEB_IDENTITY_HOME: join(base, "foreign-parent-grant") });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.doc.env, { AWEB_DELIVERY: "session", AWEB_IDENTITY_HOME: oldHome });
    assert.equal(r.doc.meta, undefined);
    assert.equal(existsSync(join(base, "aw.log")), false, "renewal off does not call aw");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("local-mode launch with renew=launch still preserves delivery launch contributions", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-113-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const custody = resident(base);
    const old = { delivery: "session", identity: { mode: "local", alias: "probe", team: "t:example.test", address: null, resident: null } };
    const r = runHook(bin, "launch", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_META: JSON.stringify(old), OATS_SETTINGS: JSON.stringify({ delivery: "session", identity: { mode: "local", renew: "launch" }, residents: { merlin: custody } }) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.doc.env, { AWEB_DELIVERY: "session" });
    assert.equal(existsSync(join(base, "aw.log")), false, "local renew=launch does not try grant renewal");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("launch renewal mints into a fresh grant home, emits the new locator, and revokes the old grant", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-113-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const custody = resident(base);
    mkdirSync(join(home, ".aweb-identity"), { recursive: true });
    const old = { delivery: "channel", identity: { mode: "global", alias: "resident-alias", team: "t:example.test", resident: "merlin", grant: { id: "grant-old", expiresAt: "old", scopes: ["mail.read"] } } };
    const r = runHook(bin, "launch", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_META: JSON.stringify(old), OATS_SETTINGS: JSON.stringify(settings(custody, { renew: "launch" })), AWEB_IDENTITY_HOME: join(base, "foreign-parent-grant") });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.doc.env.AWEB_IDENTITY_HOME, /\.aweb-identity-\d+$/);
    assert.notEqual(r.doc.env.AWEB_IDENTITY_HOME, join(home, ".aweb-identity"));
    assert.equal(existsSync(join(r.doc.env.AWEB_IDENTITY_HOME, "grant.yaml")), true);
    assert.equal(r.doc.meta.identity.grant.id.startsWith("grant-"), true);
    assert.equal(r.doc.meta.identity.grant.home, r.doc.env.AWEB_IDENTITY_HOME);
    assert.ok(logLines(base).some((l) => l.argv.join(" ") === "id grant revoke grant-old --json"));
    assert.equal(logLines(base).some((l) => l.argv.join(" ").includes("foreign-parent-grant")), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("launch renewal keeps the old grant and locator when mint fails", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-113-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const custody = resident(base);
    const oldHome = join(home, ".aweb-identity"); mkdirSync(oldHome, { recursive: true });
    const old = { identity: { mode: "global", alias: "resident-alias", team: "t:example.test", resident: "merlin", grant: { id: "grant-old", expiresAt: "old", scopes: ["mail.read"] } } };
    const r = runHook(bin, "launch", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_META: JSON.stringify(old), OATS_SETTINGS: JSON.stringify(settings(custody, { renew: "launch" })), FAKE_MINT_FAIL: "1" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.doc.env, { AWEB_IDENTITY_HOME: oldHome });
    assert.equal(r.doc.meta.identity.grant.id, "grant-old");
    assert.equal(existsSync(oldHome), true);
    assert.match(r.doc.warning, /renewal mint failed/);
    assert.equal(logLines(base).some((l) => l.argv.join(" ") === "id grant revoke grant-old --json"), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("launch renewal reports old revoke failure truthfully but keeps the new grant", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-113-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const custody = resident(base);
    const old = { identity: { mode: "global", alias: "resident-alias", team: "t:example.test", resident: "merlin", grant: { id: "grant-old", expiresAt: "old", scopes: ["mail.read"] } } };
    const r = runHook(bin, "launch", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_META: JSON.stringify(old), OATS_SETTINGS: JSON.stringify(settings(custody, { renew: "launch" })), FAKE_REVOKE_FAIL: "1" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.doc.warning, /previous grant grant-old was not revoked/);
    assert.equal(existsSync(r.doc.env.AWEB_IDENTITY_HOME), true, "new grant home kept");
    assert.notEqual(r.doc.meta.identity.grant.id, "grant-old");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("retire revokes the current grant id and removes every .aweb-identity directory", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-113-"));
  try {
    const bin = fakeAw(base); const { root, home } = deployment(base); const custody = resident(base);
    mkdirSync(join(home, ".aweb-identity"), { recursive: true });
    mkdirSync(join(home, ".aweb-identity-1"), { recursive: true });
    mkdirSync(join(home, ".aweb-identity-2"), { recursive: true });
    const meta = { identity: { mode: "global", resident: "merlin", grant: { id: "grant-current", expiresAt: "ttl", scopes: ["mail.read"] } } };
    const r = runHook(bin, "retire", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_META: JSON.stringify(meta), OATS_SETTINGS: JSON.stringify({ residents: { merlin: custody } }) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(logLines(base).some((l) => l.argv.join(" ") === "id grant revoke grant-current --json"));
    assert.equal(existsSync(join(home, ".aweb-identity")), false);
    assert.equal(existsSync(join(home, ".aweb-identity-1")), false);
    assert.equal(existsSync(join(home, ".aweb-identity-2")), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
