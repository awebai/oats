// SPIKE (#1630, the reads' own cost): one read does each piece of work once, and (a contract change, not
// decided) --max-age reuses the gh login as it reuses a head.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ghLogin, ghLoginParts } from "../lib/automations.mjs";
import { legacyCapturedHomes } from "../lib/instance-listing.mjs";
import { memberCloneOf } from "../lib/member-clone.mjs";
import { createReadSession, factObservation } from "../lib/remote.mjs";

const scratch = (t) => { const d = mkdtempSync(join(tmpdir(), "oats-read-cost-")); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const env = (over = {}) => ({ HOME: "/nonexistent-home", PATH: "/usr/bin", ...over });

/** One read's gh login: a fresh session over `cacheDir` at `now`, as a read under --max-age `maxAge` asks it. */
function readLogin({ cacheDir, maxAge, now = Date.now(), gh, environment = env() }) {
  const session = createReadSession({ maxAge, now: () => now });
  const observe = (host) => factObservation({ cacheDir, session }, "gh-login", ghLoginParts(host, environment));
  return { who: ghLogin("github.com", { io: { gh }, cache: new Map(), observe }), observation: session.observation() };
}

test("--max-age reuses a recorded gh login and says so; a live answer is recorded, a failed one is not", (t) => {
  const cacheDir = scratch(t);
  let calls = 0;
  const gh = () => { calls++; return { status: 0, stdout: "kb-bot\n" }; };
  const t0 = Date.parse("2026-10-29T12:00:00Z");
  const first = readLogin({ cacheDir, maxAge: 60, now: t0, gh });
  assert.deepEqual(first.who, { ok: true, login: "kb-bot" });
  assert.equal(calls, 1);
  assert.equal(first.observation.reused, false);
  const second = readLogin({ cacheDir, maxAge: 60, now: t0 + 30_000, gh });
  assert.deepEqual(second.who, { ok: true, login: "kb-bot" });
  assert.equal(calls, 1, "within --max-age the recorded login answers");
  assert.deepEqual(second.observation, { observedAt: new Date(t0).toISOString(), reused: true });
  // Older than --max-age, live (0), or another credential context: asked again.
  readLogin({ cacheDir, maxAge: 60, now: t0 + 61_000, gh }); assert.equal(calls, 2);
  readLogin({ cacheDir, maxAge: 0, now: t0 + 61_500, gh }); assert.equal(calls, 3);
  readLogin({ cacheDir, maxAge: 60, now: t0 + 62_000, gh, environment: env({ GH_TOKEN: "another" }) }); assert.equal(calls, 4);
});

test("a failed gh login is never reused: the next read asks again", (t) => {
  const cacheDir = scratch(t);
  let calls = 0;
  const gh = () => { calls++; return { status: 1, stdout: "", stderr: "HTTP 401: Bad credentials\n" }; };
  const a = readLogin({ cacheDir, maxAge: 60, gh });
  assert.deepEqual(a.who, { ok: false, error: "HTTP 401: Bad credentials" });
  readLogin({ cacheDir, maxAge: 60, gh });
  assert.equal(calls, 2);
});

test("the gh hosts file is part of the login's context: a login or logout rewrites it", (t) => {
  const home = scratch(t);
  const environment = env({ HOME: home });
  const before = ghLoginParts("github.com", environment);
  mkdirSync(join(home, ".config", "gh"), { recursive: true });
  writeFileSync(join(home, ".config", "gh", "hosts.yml"), "github.com:\n  user: kb-bot\n");
  assert.notDeepEqual(ghLoginParts("github.com", environment), before);
  assert.deepEqual(ghLoginParts("github.com", environment), ghLoginParts("github.com", environment));
});

test("one read asks git for a clone's remotes once, however many times it verifies the clone", (t) => {
  const deployment = scratch(t);
  const clone = join(deployment, "tools");
  mkdirSync(clone);
  const git = (...args) => execFileSync("git", ["-C", clone, ...args], { stdio: "ignore" });
  git("init", "-q"); git("remote", "add", "origin", "https://github.com/acme/tools.git");
  const remotes = new Map();
  assert.deepEqual(memberCloneOf(deployment, {}, "github.com/acme/tools", { remotes }), { path: clone, rule: "convention" });
  // The clone changes under the read: the read keeps what it saw, so git was not asked again.
  git("remote", "set-url", "origin", "https://github.com/acme/other.git");
  assert.deepEqual(memberCloneOf(deployment, {}, "github.com/acme/tools", { remotes }), { path: clone, rule: "convention" });
  // A new read (no map, or a new one) asks git afresh.
  assert.throws(() => memberCloneOf(deployment, {}, "github.com/acme/tools", { remotes: new Map() }), { code: "E_CLONE_MISMATCH" });
  assert.throws(() => memberCloneOf(deployment, {}, "github.com/acme/tools"), { code: "E_CLONE_MISMATCH" });
});

test("legacyCapturedHomes takes a home's record from the same read's listing, and reads the rest itself", (t) => {
  const root = scratch(t);
  const homeA = join(root, "dev", "instances", "a"), homeB = join(root, "dev", "instances", "b");
  for (const h of [homeA, homeB]) mkdirSync(h, { recursive: true });
  writeFileSync(join(homeA, "instance.json"), JSON.stringify({ instance: "a" }));
  writeFileSync(join(homeB, "instance.json"), JSON.stringify({ instance: "b" }));
  assert.equal(legacyCapturedHomes(root), null);
  // What the listing read stands for the file: a captured record the listing saw is named, even if the file changed since.
  const captured = { instance: "a", captured: true, portable: true };
  const records = new Map([[homeA, captured]]);
  const withRecords = legacyCapturedHomes(root, { records });
  const direct = (() => { writeFileSync(join(homeA, "instance.json"), JSON.stringify(captured)); return legacyCapturedHomes(root); })();
  assert.deepEqual(withRecords, direct);
});
