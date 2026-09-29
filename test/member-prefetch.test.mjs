/** The member prefetch (spec Addendum 3; lib/workspace.mjs prefetchMembers, lib/remote.mjs
 *  prefetchObservation): a whole-workspace discovery starts its members' head observations with the host's,
 *  from the member list at the host's last observed commit. The answer is exactly the one without it, a
 *  member no longer listed never appears, every head is observed once per command (a prefetched failure is
 *  adopted, not retried), at most LS_REMOTE_LIMIT ls-remotes run at once, and observeWorkspace alone
 *  never prefetches. Real bare repos; ls-remote counted and timed through an injected exec. */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { LS_REMOTE_LIMIT, createReadSession, runGit } from "../lib/remote.mjs";
import { discoverWorkspace, observeWorkspace } from "../lib/workspace.mjs";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const roots = [];
test.after(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });

/** A workspace: host `host.git` listing `names` (bare repos, each backlinking), refs as file: URLs. */
function workspace(names) {
  const base = mkdtempSync(join(tmpdir(), "oats-prefetch-"));
  roots.push(base);
  const bare = (n) => join(base, `${n}.git`);
  const url = (n) => pathToFileURL(bare(n)).href;
  const hostRef = url("host");
  const commitTree = (name, files) => {
    const work = join(base, `${name}-work`);
    if (!readdirSync(base).includes(`${name}.git`)) { git(base, "init", "-q", "--bare", "-b", "main", bare(name)); git(base, "init", "-q", "-b", "main", work); }
    for (const [rel, body] of Object.entries(files)) { mkdirSync(join(work, rel, ".."), { recursive: true }); writeFileSync(join(work, rel), YAML.stringify(body)); }
    git(work, "add", "-A"); git(work, "commit", "-q", "--allow-empty", "-m", "c"); git(work, "push", "-q", bare(name), "HEAD:main");
  };
  const member = (n) => commitTree(n, { "oats-membership.yaml": { schemaVersion: 2, workspace: hostRef }, [`souls/${n}-soul/soul.yaml`]: { schemaVersion: 2, name: `${n}-soul`, description: "d", work: "directory" } });
  names.forEach(member);
  const list = (refs) => commitTree("host", { "oats-workspace.yaml": { schemaVersion: 2, name: "ws", members: refs } });
  list(names.map(url));
  return { base, hostRef, url, path: bare, member, list, cacheDir: join(base, "cache") };
}
/** An exec that counts and times every ls-remote (by url), optionally delaying or failing some. */
function tracing({ delay = () => 0, failUrl = null } = {}) {
  const calls = [];
  let active = 0, maxActive = 0;
  const exec = async (args, opts) => {
    if (args[0] !== "ls-remote") return runGit(args, opts);
    const call = { url: args[2], start: performance.now(), end: null };
    calls.push(call);
    active++; maxActive = Math.max(maxActive, active);
    try {
      const ms = delay(args[2]);
      if (ms) await new Promise((r) => setTimeout(r, ms));
      if (args[2] === failUrl) throw Object.assign(new Error("x"), { stderr: Buffer.from("fatal: unable to access: Could not resolve host") });
      return await runGit(args, opts);
    } finally { active--; call.end = performance.now(); }
  };
  const count = (u) => calls.filter((c) => c.url === u).length;
  return { exec, calls, count, max: () => maxActive };
}
const normal = (d) => JSON.parse(JSON.stringify(d, (k, v) => (k === "observedAt" ? undefined : v)));
const discover = (ws, options = {}) => discoverWorkspace(ws.hostRef, { local: {}, remoteOptions: { cacheDir: ws.cacheDir, ...options } });
async function warm(ws) { const s = createReadSession(); await discover(ws, { session: s }); await s.close(); }
const hostPath = (ws) => ws.path("host"); // the url ls-remote sees for a file: ref

test("unchanged list: the answer equals discovery without a session; ls-remote = members + 1, each once; members start before the host answers", async () => {
  const ws = workspace(["a", "b", "c"]);
  const reference = normal(await discover(ws));
  await warm(ws);
  const t = tracing({ delay: (u) => (u === hostPath(ws) ? 150 : 0) });
  const session = createReadSession();
  const got = await discover(ws, { exec: t.exec, session });
  await session.close();
  assert.deepStrictEqual(normal(got), reference);
  assert.equal(t.calls.length, 4, t.calls.map((c) => c.url).join(", "));
  for (const n of ["host", "a", "b", "c"]) assert.equal(t.count(ws.path(n)), 1, `${n} observed once`);
  const host = t.calls.find((c) => c.url === hostPath(ws));
  assert.ok(t.calls.filter((c) => c !== host).every((c) => c.start < host.end), "every member observation started while the host's was running");
});

test("the list changed (a member added, one removed, one respelled): the answer is today's; the dropped member costs one unused ls-remote and is not in it", async () => {
  const ws = workspace(["a", "b", "d"]);
  // d is reachable under two spellings of one key (ssh and https), both mapped onto its bare repo.
  const https = "https://example.invalid/org/d.git", ssh = "git@example.invalid:org/d.git";
  const cfg = join(ws.base, "gitconfig");
  writeFileSync(cfg, [https, ssh].map((u) => `[url "${ws.path("d")}"]\n\tinsteadOf = ${u}\n`).join(""));
  const saved = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = cfg;
  try {
    ws.list([ws.url("a"), ws.url("b"), https]);
    await warm(ws);
    ws.member("c");
    ws.list([ws.url("a"), ws.url("c"), ssh]); // b removed, c added, d respelled
    const reference = normal(await discover(ws));
    const t = tracing();
    const session = createReadSession();
    const got = await discover(ws, { exec: t.exec, session });
    await session.close();
    assert.deepStrictEqual(normal(got), reference);
    assert.deepEqual(got.members.map((m) => m.ref), [ws.url("a"), ws.url("c"), ssh]);
    assert.ok(!JSON.stringify(got).includes("b-soul"), "the dropped member is nowhere in the answer");
    assert.equal(t.count(ws.path("b")), 1, "b: one prefetch, unused");
    assert.equal(t.count(https), 1, "d's old spelling: one prefetch, unused");
    for (const u of [hostPath(ws), ws.path("a"), ws.path("c"), ssh]) assert.equal(t.count(u), 1, `${u} once`);
  } finally { if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved; }
});

test("a prefetched head nobody uses is not counted in the observation: oldest-wins covers the heads the answer used", async () => {
  const ws = workspace(["a", "b"]);
  await warm(ws);
  // b's record is older than everyone's (reusable under 60 s); b is then dropped from the list, and the
  // host's record is expired so the host is observed live and the new list is the one used.
  const recordOf = (n) => readdirSync(join(ws.cacheDir, ".observed")).map((f) => join(ws.cacheDir, ".observed", f)).find((p) => JSON.parse(readFileSync(p, "utf8")).key === `local/${ws.path(n)}`);
  const setAt = (n, iso) => { const f = recordOf(n); writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), observedAt: iso })); };
  const old = new Date(Date.now() - 50_000).toISOString();
  setAt("b", old);
  setAt("host", new Date(Date.now() - 120_000).toISOString());
  ws.list([ws.url("a")]);
  const session = createReadSession({ maxAge: 60 });
  const got = await discover(ws, { session });
  await session.close();
  assert.deepEqual(got.members.map((m) => m.ref), [ws.url("a")]);
  assert.notEqual(session.observation().observedAt, old, "b's prefetched (reused) observation is not one the answer used");
});

test("a failed prefetch is adopted by the member's own observation, never retried in the command", async () => {
  const ws = workspace(["a", "b"]);
  await warm(ws);
  const t = tracing({ failUrl: ws.path("b") });
  const session = createReadSession();
  const got = await discover(ws, { exec: t.exec, session });
  await session.close();
  const b = got.members.find((m) => m.ref === ws.url("b"));
  assert.equal(b.confirmed, false);
  assert.equal(b.reason, "cannot-read");
  assert.equal(t.count(ws.path("b")), 1, "one ls-remote for b in the whole command");
  // Without a prefetch (no session memo), the answer is the same.
  const plain = await discover(ws, { exec: tracing({ failUrl: ws.path("b") }).exec });
  assert.deepStrictEqual(normal(got), normal(plain));
});

test(`at most LS_REMOTE_LIMIT (${LS_REMOTE_LIMIT}) ls-remotes run at once, prefetched and real together`, async () => {
  const names = Array.from({ length: 13 }, (_, i) => `m${i}`);
  const ws = workspace(names);
  await warm(ws);
  const t = tracing({ delay: () => 60 });
  const session = createReadSession();
  const got = await discover(ws, { exec: t.exec, session });
  await session.close();
  assert.equal(got.members.filter((m) => m.confirmed).length, 13);
  assert.equal(t.calls.length, 14, "each head once");
  assert.equal(t.max(), LS_REMOTE_LIMIT, "the limit is reached, never passed");
});

test("no prefetch: observeWorkspace alone, a missing or corrupt host record, a missing parsed workspace entry", async () => {
  const ws = workspace(["a", "b"]);
  await warm(ws);
  // observeWorkspace alone (the teams reads, inspect --home): the host only.
  let t = tracing();
  let session = createReadSession();
  await observeWorkspace(ws.hostRef, { remoteOptions: { cacheDir: ws.cacheDir, exec: t.exec, session } });
  await new Promise((r) => setTimeout(r, 50));
  await session.close();
  assert.deepEqual(t.calls.map((c) => c.url), [hostPath(ws)]);
  // Each missing source: members are observed only after the host answered (one round later).
  const hostRecord = join(ws.cacheDir, ".observed", `${sha256(`local/${hostPath(ws)}\0HEAD\0${sha256(hostPath(ws))}`)}.json`);
  const cases = {
    "corrupt host record": () => writeFileSync(hostRecord, "{ nope"),
    "no host record": () => rmSync(hostRecord, { force: true }),
    "no parsed workspace entry": () => rmSync(join(ws.cacheDir, ".parsed"), { recursive: true, force: true }),
  };
  for (const [name, breakIt] of Object.entries(cases)) {
    await warm(ws);
    breakIt();
    t = tracing({ delay: (u) => (u === hostPath(ws) ? 100 : 0) });
    session = createReadSession();
    await discover(ws, { exec: t.exec, session });
    await session.close();
    const host = t.calls.find((c) => c.url === hostPath(ws));
    assert.ok(t.calls.filter((c) => c !== host).every((c) => c.start >= host.end), `${name}: no member observation before the host answered`);
    assert.equal(t.calls.length, 3, `${name}: each head once`);
  }
});
