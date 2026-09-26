// oats.aweb 1.12.1 default-readiness behaviour, against fake `aw` on PATH:
// explicit messaging roots, v2 remedies, work-dir aw env, and binding-check.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const HOOK = resolve(new URL("../capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const BINDING = resolve(new URL("../capabilities/oats-aweb/bin/oats-aweb-binding.mjs", import.meta.url).pathname);

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
function awRoot(dir) { mkdirSync(join(dir, ".aw"), { recursive: true }); }

function fakeAw(base) {
  const bin = join(base, "bin"); mkdirSync(bin, { recursive: true });
  write(join(bin, "aw"), `#!/usr/bin/env node
const fs = require("node:fs");
const a = process.argv.slice(2);
const s = a.join(" ");
const log = ${JSON.stringify(join(base, "aw.log"))};
fs.appendFileSync(log, JSON.stringify({ argv: a, cwd: process.cwd(), identityHome: process.env.AWEB_IDENTITY_HOME || null }) + "\\n");
const j = (obj) => JSON.stringify(obj, null, 2);
if (s === "version") { console.log("aw 1.36.1"); process.exit(0); }
if (s.startsWith("wake ")) process.exit(0);
if (s.startsWith("team list")) { console.log(j({ active_team: "t:example.test", memberships: [{ team_id: "t:example.test" }] })); process.exit(0); }
if (s.startsWith("team invite")) { console.log(j({ token: "TOK-secret" })); process.exit(0); }
if (s.startsWith("team join")) { console.log(j({ alias: "probe", team_id: "t:example.test" })); process.exit(0); }
if (s.startsWith("init")) process.exit(0);
if (s.startsWith("workspace delete")) { console.log(j({ alias_released: true, alias_released_reason: "revoked" })); process.exit(0); }
console.error("fake aw: unexpected " + s); process.exit(2);
`);
  chmodSync(join(bin, "aw"), 0o755);
  return bin;
}

function runHook(bin, event, env) {
  const r = spawnSync(process.execPath, [HOOK, event], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OATS_EVENT: event, ...env } });
  let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
  return { ...r, doc };
}

function logLines(base) {
  const text = readFileSync(join(base, "aw.log"), "utf8").trim();
  return text ? text.split(/\n/).map((l) => JSON.parse(l)) : [];
}

function bindingRequest(settings = {}) {
  return {
    schemaVersion: 1,
    phase: "check",
    slot: "messaging",
    capability: "oats.aweb",
    settings,
    input: {
      context: { kind: "standalone", key: "fixture" },
      action: { kind: "inspect" },
      binding: {
        schemaVersion: 1,
        capability: "oats.aweb",
        payloadContract: "oats.aweb.messaging",
        payloadVersion: 1,
        payload: {
          responsibleHuman: { provider: "oats.aweb", id: "pepe" },
          context: { kind: "standalone", key: "fixture" },
          privateTeam: { provider: "oats.aweb", id: "private:example.test" },
          wider: [],
        },
        credentialRefs: {},
        provenance: [],
      },
    },
  };
}

function runBinding(input, env = {}) {
  const r = spawnSync(process.execPath, [BINDING, "check"], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, ...env } });
  let doc; try { doc = JSON.parse(r.stdout); } catch { doc = undefined; }
  return { ...r, doc };
}

test("spawn uses roots[team] before root/workspace and local mode exports AWEB_IDENTITY_HOME", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-1121-"));
  try {
    const bin = fakeAw(base);
    const workspace = join(base, "workspace"); awRoot(workspace);
    const declaredRoot = join(base, "declared-root"); awRoot(declaredRoot);
    const teamRoot = join(base, "team-root"); awRoot(teamRoot);
    const home = join(workspace, "agents", "dev", "instances", "probe"); mkdirSync(home, { recursive: true });
    const r = runHook(bin, "spawn", {
      OATS_INSTANCE: "probe",
      OATS_HOME: home,
      OATS_WORKSPACE: workspace,
      OATS_CONTEXT: workspace,
      OATS_SETTINGS: JSON.stringify({ team: "t:example.test", root: declaredRoot, roots: { "t:example.test": teamRoot } }),
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.doc.env, { AWEB_IDENTITY_HOME: join(home, ".aw") });
    const invite = logLines(base).find((l) => l.argv.join(" ").startsWith("team invite"));
    assert.equal(invite.cwd, realpathSync(teamRoot));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("declared root without .aw is fatal and names the v2 root remedy without bounded search prose", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-1121-"));
  try {
    const bin = fakeAw(base);
    const workspace = join(base, "workspace"); awRoot(workspace);
    const declaredRoot = join(base, "declared-root"); mkdirSync(declaredRoot, { recursive: true });
    const home = join(workspace, "agents", "dev", "instances", "probe"); mkdirSync(home, { recursive: true });
    const r = runHook(bin, "spawn", {
      OATS_INSTANCE: "probe",
      OATS_HOME: home,
      OATS_WORKSPACE: workspace,
      OATS_CONTEXT: workspace,
      OATS_SETTINGS: JSON.stringify({ team: "t:example.test", root: declaredRoot }),
    });
    assert.notEqual(r.status, 0);
    assert.match(r.doc.warning, new RegExp(`no messaging root at ${declaredRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(r.doc.warning, /settings\.oats\.aweb\.root/);
    assert.match(r.doc.warning, /oats aweb setup/);
    assert.doesNotMatch(r.doc.warning, /bounded candidates|oats-config\.yaml|team:/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("v2 spawn does not search above OATS_WORKSPACE when no root is declared", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-1121-"));
  try {
    const bin = fakeAw(base);
    awRoot(base);
    const workspace = join(base, "workspace"); mkdirSync(workspace, { recursive: true });
    const home = join(workspace, "agents", "dev", "instances", "probe"); mkdirSync(home, { recursive: true });
    const r = runHook(bin, "spawn", {
      OATS_INSTANCE: "probe",
      OATS_HOME: home,
      OATS_WORKSPACE: workspace,
      OATS_CONTEXT: workspace,
      OATS_SETTINGS: JSON.stringify({ team: "t:example.test" }),
    });
    assert.notEqual(r.status, 0);
    assert.match(r.doc.warning, new RegExp(`no messaging root at ${workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.equal(existsSync(join(base, "aw.log")) && readFileSync(join(base, "aw.log"), "utf8").includes("team invite"), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// RETIRED (oats.aweb 1.14.1): "classic spawn keeps 1.12.0 bounded root precedence before OATS_WORKSPACE".
// 1.14 refuses the classic environment outright (no kernel produces it since 0.26); what stays is that the
// refusal is fatal before anything is minted.
test("a classic environment (OATS_TEAM_SCOPE without workspace facts) is refused before any aw call", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-1121-"));
  try {
    const bin = fakeAw(base);
    const teamScope = join(base, "team-scope"); awRoot(teamScope);
    const workspace = join(base, "workspace"); awRoot(workspace);
    const home = join(workspace, "agents", "dev", "instances", "probe"); mkdirSync(home, { recursive: true });
    const r = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: workspace, OATS_CONTEXT: workspace, OATS_TEAM_SCOPE: teamScope, OATS_TEAM_ID: "t:example.test", OATS_SETTINGS: JSON.stringify({}) });
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.doc.warning, "oats-aweb: oats.aweb 1.14 needs OATS 0.26.0 or newer (workspace model); on an older kernel pin oats.aweb v1.13.x");
    assert.equal(existsSync(join(base, "aw.log")), false, "nothing was asked of aw, so nothing was minted");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("setup in v2 reads settings root/team and prints v2 remedies", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-1121-"));
  try {
    const bin = fakeAw(base);
    const workspace = join(base, "workspace"); mkdirSync(workspace, { recursive: true });
    let r = runHook(bin, "setup", { OATS_WORKSPACE: workspace, OATS_SETTINGS: JSON.stringify({}) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /set settings\.oats\.aweb\.team or keep an active team at the aweb root/);
    assert.doesNotMatch(r.stdout, /oats-config\.yaml|messaging\.byTeam|team:/);
    const root = join(base, "declared-root"); mkdirSync(root, { recursive: true });
    r = runHook(bin, "setup", { OATS_WORKSPACE: workspace, OATS_SETTINGS: JSON.stringify({ team: "t:example.test", root }) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /oats aweb setup --username <u>/);
    assert.match(r.stdout, /AWEB_API_KEY=<key> oats aweb setup/);
    assert.match(r.stdout, /oats aweb setup --invite <token>/);
    assert.match(r.stdout, /settings\.oats\.aweb\.root/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("binding-check reports one v2 problem per missing root/team and ready once both exist", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-1121-"));
  try {
    const workspace = join(base, "workspace"); mkdirSync(workspace, { recursive: true });
    let r = runBinding(bindingRequest({ delivery: "session" }), { OATS_WORKSPACE: workspace });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.doc.ok, true);
    assert.equal(r.doc.result.status, "needs-configuration");
    assert.deepEqual(r.doc.result.problems.map((p) => p.message), [
      `no messaging root at ${workspace}: run oats aweb setup there or set settings.oats.aweb.root`,
      "no team: set settings.oats.aweb.team or keep an active team at the aweb root",
    ]);
    awRoot(workspace);
    r = runBinding(bindingRequest({ delivery: "session", team: "t:example.test" }), { OATS_WORKSPACE: workspace });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.doc.result, { status: "ready", problems: [] });
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// RETIRED (oats.aweb 1.14.1): "binding-check accepts classic team from environment without settings.team".
// 1.14 reads no team from OATS_TEAM_ID (lead decision K): the team is settings.oats.aweb.team or the root's
// active team, covered above and below.

test("an unmapped v2 team label uses the workspace's default team (the root's active team) with a team-unmapped warning; with none, the check reports no team", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-1121-"));
  try {
    const bin = fakeAw(base);
    const workspace = join(base, "workspace"); awRoot(workspace);
    const teamScope = join(base, "deployment-dir"); awRoot(teamScope);
    const home = join(workspace, "agents", "dev", "instances", "probe"); mkdirSync(home, { recursive: true });
    // What the kernel's teamEnv exports for a home whose primary label has no messaging.byTeam mapping.
    const env = { OATS_WORKSPACE: workspace, OATS_TEAM_SCOPE: teamScope, OATS_WORKSPACE_KEY: "fixture-workspace", OATS_WORKSPACE_NAME: "Fixture Workspace", OATS_TEAM_LABEL: "engineering", OATS_TEAM_LABELS: "engineering", OATS_TEAMS: JSON.stringify([{ label: "engineering", team: null, mapped: false }]), OATS_TEAM_ID: "" };
    // No active team at the root: nothing to fall back to.
    let check = runBinding(bindingRequest({ delivery: "session" }), env);
    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.deepEqual(check.doc.result, { status: "needs-configuration", problems: [{ code: "needs-configuration", message: "no team: set settings.oats.aweb.team or keep an active team at the aweb root" }] });
    // The root keeps an active team: the label falls back to it and readiness stays ready.
    write(join(workspace, ".aw", "teams.yaml"), "active_team: t:example.test\n");
    check = runBinding(bindingRequest({ delivery: "session" }), env);
    assert.deepEqual(check.doc.result, { status: "ready", problems: [] });
    const spawn = runHook(bin, "spawn", { ...env, OATS_INSTANCE: "probe", OATS_HOME: home, OATS_CONTEXT: workspace, OATS_SETTINGS: JSON.stringify({}) });
    assert.equal(spawn.status, 0, spawn.stdout + spawn.stderr);
    assert.equal(spawn.doc.warning, "oats-aweb: team-unmapped — workspace label engineering is not mapped; using personal team t:example.test");
    assert.equal(spawn.doc.meta.team, "t:example.test");
    const invite = logLines(base).find((l) => l.argv.join(" ").startsWith("team invite"));
    assert.deepEqual(invite.argv.slice(2, 4), ["--team-id", "t:example.test"], "minted into the workspace's default team, named explicitly");
    assert.equal(JSON.stringify(spawn.doc).includes("TOK-secret"), false, "the invite token never reaches the output");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
