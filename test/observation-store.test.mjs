/** The observation store behind `--max-age` (lib/remote.mjs; docs/desktop-cli-api.md "Observation reuse"):
 *  every successful live head observation in a session is recorded (never the url: its digest), a record
 *  is reused only under maxAge and only when the key, the ref args AND the url digest match, a reused
 *  record whose commit cannot be had falls back to a live observation, a failed live observation is
 *  today's error, and nothing written to the cache root ever carries a credential. */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { createReadSession, observeRemote, parseRepoRef, readRemoteFile, runGit } from "../lib/remote.mjs";
import { discoverWorkspace } from "../lib/workspace.mjs";
import { lockedPackageCapabilities } from "../lib/resolve.mjs";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const roots = [];
function scratch() { const d = mkdtempSync(join(tmpdir(), "oats-observed-")); roots.push(d); return d; }
test.after(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });
const writeTree = (dir, files) => { for (const [rel, body] of Object.entries(files)) { mkdirSync(join(dir, rel, ".."), { recursive: true }); writeFileSync(join(dir, rel), typeof body === "string" ? body : rel.endsWith(".json") ? JSON.stringify(body) : YAML.stringify(body)); } };

function repo(base, name, files = { "README.md": "hi\n" }) {
  const bare = join(base, `${name}.git`), work = join(base, `${name}-work`);
  git(base, "init", "-q", "--bare", "-b", "main", bare);
  git(base, "init", "-q", "-b", "main", work);
  writeTree(work, files);
  git(work, "add", "-A"); git(work, "commit", "-q", "-m", "one"); git(work, "push", "-q", bare, "HEAD:main");
  const push = (more) => { writeTree(work, more); git(work, "add", "-A"); git(work, "commit", "-q", "-m", "more"); git(work, "push", "-q", bare, "HEAD:main"); return git(work, "rev-parse", "HEAD"); };
  return { bare, work, ref: pathToFileURL(bare).href, key: `local/${bare}`, url: bare, commit: git(work, "rev-parse", "HEAD"), push };
}
/** The record of `remote` ({ key, url }: a repo() here, or a parsed ref) for these ref args. */
const recordFile = (cacheDir, remote, args = ["HEAD"]) => join(cacheDir, ".observed", `${sha256(`${remote.key}\0${args.join("\0")}\0${sha256(remote.url)}`)}.json`);
const readRecord = (cacheDir, remote, args) => JSON.parse(readFileSync(recordFile(cacheDir, remote, args), "utf8"));
const setObservedAt = (cacheDir, remote, iso) => { const f = recordFile(cacheDir, remote); writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), observedAt: iso })); };
function counting() {
  const calls = [];
  // The git verb: the first argument that is neither an option nor the value of `-C`/`-c`.
  const verb = (args) => args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "-C" && args[i - 1] !== "-c") ?? args[0];
  const exec = (args, opts) => { calls.push(verb(args)); return runGit(args, opts); };
  return { exec, calls };
}
const ago = (ms) => new Date(Date.now() - ms).toISOString();

test("a successful live head observation in a session is recorded — key, ref args, url digest, peeled commit, ref, observedAt; never the url; nothing without a session, on failure, or for a full OID", async () => {
  const base = scratch(), r = repo(base, "a"), cacheDir = join(base, "cache");
  await observeRemote(r.bare, { cacheDir });
  await observeRemote(r.bare, { at: r.commit, cacheDir, session: createReadSession() });
  assert.equal(existsSync(join(cacheDir, ".observed")), false, "no session, or a pinned OID: no record");
  await assert.rejects(observeRemote(join(base, "nope.git"), { cacheDir, session: createReadSession() }));
  assert.equal(existsSync(join(cacheDir, ".observed")), false, "a failure is never recorded");
  const obs = await observeRemote(r.bare, { cacheDir, session: createReadSession() });
  const rec = readRecord(cacheDir, r);
  assert.deepEqual(Object.keys(rec), ["v", "key", "args", "urlDigest", "commit", "ref", "observedAt"]);
  assert.deepEqual(rec, { v: 1, key: r.key, args: ["HEAD"], urlDigest: sha256(r.bare), commit: r.commit, ref: "refs/heads/main", observedAt: obs.observedAt });
  assert.equal(statSync(recordFile(cacheDir, r)).mode & 0o777, 0o600);
  // An annotated tag: the ref args are the tag patterns, the commit recorded is the peeled one.
  git(r.work, "tag", "-a", "v1", "-m", "release"); git(r.work, "push", "-q", r.bare, "--tags");
  const tagged = await observeRemote(r.bare, { at: "v1", cacheDir, session: createReadSession() });
  const tagArgs = ["refs/tags/v1", "refs/tags/v1^{}", "refs/heads/v1", "v1"];
  assert.equal(tagged.commit, r.commit);
  assert.equal(readRecord(cacheDir, r, tagArgs).commit, r.commit);
  assert.equal(readRecord(cacheDir, r, tagArgs).ref, "refs/tags/v1");
});

test("reuse: under maxAge a fresh record answers with its own observedAt and reused: true — no git at all when its commit is pinned", async () => {
  const base = scratch(), r = repo(base, "a"), cacheDir = join(base, "cache");
  const live = await observeRemote(r.bare, { cacheDir, session: createReadSession() });
  r.push({ "README.md": "moved\n" }); // the remote moved on; a reused record still names the old head
  const { exec, calls } = counting();
  const reused = await observeRemote(r.bare, { cacheDir, exec, session: createReadSession({ maxAge: 60 }) });
  assert.deepEqual(reused, { ...live, reused: true });
  assert.deepEqual(calls, [], "a pinned commit costs no git process");
  // maxAge 0 is live: the new head, and nothing reused.
  const fresh = await observeRemote(r.bare, { cacheDir, exec, session: createReadSession({ maxAge: 0 }) });
  assert.notEqual(fresh.commit, live.commit);
  assert.equal(fresh.reused, undefined);
  assert.ok(calls.includes("ls-remote"));
});

test("reuse: an unpinned recorded commit is fetched first; one that cannot be had is observed live, never an error", async () => {
  const base = scratch(), r = repo(base, "a"), cacheDir = join(base, "cache");
  await observeRemote(r.bare, { cacheDir, session: createReadSession() });
  const cacheRepo = join(cacheDir, sha256(r.key));
  rmSync(join(cacheRepo, "refs", "oats"), { recursive: true, force: true }); // the pin is gone (objects stay)
  const { exec, calls } = counting();
  const again = await observeRemote(r.bare, { cacheDir, exec, session: createReadSession({ maxAge: 60 }) });
  assert.equal(again.reused, true);
  assert.ok(!calls.includes("ls-remote") && calls.includes("rev-parse"), "ensureCommit, not ls-remote");
  // A record naming a commit the remote does not have: live, and the live answer is recorded.
  setObservedAt(cacheDir, r, new Date().toISOString());
  const f = recordFile(cacheDir, r);
  writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), commit: "9".repeat(40) }));
  rmSync(join(cacheRepo, "refs", "oats"), { recursive: true, force: true });
  const live = await observeRemote(r.bare, { cacheDir, session: createReadSession({ maxAge: 60 }) });
  assert.equal(live.reused, undefined);
  assert.equal(live.commit, r.commit);
  assert.equal(readRecord(cacheDir, r).commit, r.commit);
});

test("the max-age boundary and clock skew: older than maxAge or more than 5 s ahead is observed live; within is reused", async () => {
  const base = scratch(), r = repo(base, "a"), cacheDir = join(base, "cache");
  await observeRemote(r.bare, { cacheDir, session: createReadSession() });
  const now = Date.now();
  const at = (offsetMs) => new Date(now + offsetMs).toISOString();
  const session = (maxAge) => createReadSession({ maxAge, now: () => now });
  for (const [offset, maxAge, reused] of [[-61_000, 60, false], [-60_000, 60, true], [-59_000, 60, true], [4_000, 60, true], [6_000, 60, false], [-3_600_000, 3_600, true], [-1_000, 0, false]]) {
    setObservedAt(cacheDir, r, at(offset));
    const obs = await observeRemote(r.bare, { cacheDir, session: session(maxAge) });
    assert.equal(obs.reused === true, reused, `record ${offset / 1000}s old, maxAge ${maxAge}`);
    if (reused) assert.equal(obs.observedAt, at(offset), "the RECORDED time, never now");
  }
});

test("a corrupt, partial, zero-byte or mismatched record (key, args, url digest, commit) is a miss: observed live", async () => {
  const base = scratch(), r = repo(base, "a"), cacheDir = join(base, "cache");
  await observeRemote(r.bare, { cacheDir, session: createReadSession() });
  const f = recordFile(cacheDir, r);
  const good = readFileSync(f, "utf8");
  const edits = {
    garbage: () => "{ nope", partial: () => good.slice(0, 20), empty: () => "",
    key: () => JSON.stringify({ ...JSON.parse(good), key: "local/elsewhere" }), args: () => JSON.stringify({ ...JSON.parse(good), args: ["refs/heads/main"] }),
    urlDigest: () => JSON.stringify({ ...JSON.parse(good), urlDigest: sha256("https://example.invalid/x.git") }), commit: () => JSON.stringify({ ...JSON.parse(good), commit: "HEAD" }),
    version: () => JSON.stringify({ ...JSON.parse(good), v: 2 }), observedAt: () => JSON.stringify({ ...JSON.parse(good), observedAt: "yesterday" }),
  };
  for (const [name, edit] of Object.entries(edits)) {
    writeFileSync(f, edit());
    const { exec, calls } = counting();
    const obs = await observeRemote(r.bare, { cacheDir, exec, session: createReadSession({ maxAge: 600 }) });
    assert.equal(obs.reused, undefined, name);
    assert.ok(calls.includes("ls-remote"), `${name}: observed live`);
    assert.equal(JSON.parse(readFileSync(f, "utf8")).v, 1, `${name}: the live observation rewrote an intact record`);
  }
});

test("a failed live observation is today's error even with an older record, and the record is left alone", async () => {
  const base = scratch(), r = repo(base, "a"), cacheDir = join(base, "cache");
  await observeRemote(r.bare, { cacheDir, session: createReadSession() });
  setObservedAt(cacheDir, r, ago(3_600_000)); // too old for maxAge 60
  const before = readFileSync(recordFile(cacheDir, r), "utf8");
  const failing = (args, opts) => (args.includes("ls-remote") ? Promise.reject(Object.assign(new Error("x"), { stderr: Buffer.from("fatal: unable to access: Could not resolve host") })) : runGit(args, opts));
  await assert.rejects(observeRemote(r.bare, { cacheDir, exec: failing, session: createReadSession({ maxAge: 60 }) }), (e) => e.code === "E_REMOTE_UNREADABLE" && e.details.reason === "network");
  assert.equal(readFileSync(recordFile(cacheDir, r), "utf8"), before);
});

/** git config that maps credential-bearing and ssh/https spellings of one key onto a local bare repo. */
function insteadOf(base, bare, urls) {
  const cfg = join(base, "gitconfig");
  writeFileSync(cfg, urls.map((u) => `[url "${bare}"]\n\tinsteadOf = ${u}\n`).join(""));
  const saved = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = cfg;
  return () => { if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved; };
}

test("maintainer rule: a record is a hit only when the key, the ref AND the url digest match — an ssh-spelled observation is a miss for the https spelling", async () => {
  const base = scratch(), r = repo(base, "a"), cacheDir = join(base, "cache");
  const ssh = "ssh://git@example.invalid/org/ws.git", https = "https://example.invalid/org/ws.git";
  const restore = insteadOf(base, r.bare, [ssh, https]);
  try {
    const bySsh = await observeRemote(ssh, { cacheDir, session: createReadSession() });
    assert.equal(bySsh.key, "example.invalid/org/ws");
    const { exec, calls } = counting();
    const byHttps = await observeRemote(https, { cacheDir, exec, session: createReadSession({ maxAge: 60 }) });
    assert.equal(byHttps.reused, undefined, "a miss: observed live");
    assert.ok(calls.includes("ls-remote"));
    assert.equal(readRecord(cacheDir, parseRepoRef(https)).urlDigest, sha256(https));
    assert.equal((await observeRemote(https, { cacheDir, session: createReadSession({ maxAge: 60 }) })).reused, true, "the same spelling is reused");
  } finally { restore(); }
});

test("two spellings of one repo keep a record each: observed in turn, each is reused afterwards", async () => {
  const base = scratch(), r = repo(base, "a"), cacheDir = join(base, "cache");
  const ssh = "ssh://git@example.invalid/org/ws.git", https = "https://example.invalid/org/ws.git";
  const restore = insteadOf(base, r.bare, [ssh, https]);
  try {
    const live = createReadSession();
    await observeRemote(ssh, { cacheDir, session: live });
    await observeRemote(https, { cacheDir, session: live });
    const files = readdirSync(join(cacheDir, ".observed")).sort();
    assert.deepEqual(files, [recordFile(cacheDir, parseRepoRef(ssh)), recordFile(cacheDir, parseRepoRef(https))].map((f) => f.split("/").pop()).sort(), "one record per spelling");
    for (const spelling of [ssh, https, ssh]) {
      const { exec, calls } = counting();
      const obs = await observeRemote(spelling, { cacheDir, exec, session: createReadSession({ maxAge: 60 }) });
      assert.equal(obs.reused, true, `${spelling}: reused`);
      assert.ok(!calls.includes("ls-remote"), `${spelling}: no ls-remote`);
    }
  } finally { restore(); }
});

test("no file under the cache root carries a credential from a url with userinfo (observation records, parsed entries, cache repos)", async () => {
  const base = scratch(), cacheDir = join(base, "cache");
  const pkg = repo(base, "pkg", {
    "oats-package/oats-package.json": { package: "fx.pkg", version: "1.0.0", capabilities: ["capabilities/pc"] },
    "oats-package/capabilities/pc/oats.json": { capability: "pc", version: "1.0.0", compatibility: { oats: ">=0.24.0" } },
  });
  const withToken = "ssh://git:s3cr3t-t0ken@example.invalid/org/pkg.git";
  const restore = insteadOf(base, pkg.bare, [withToken]);
  try {
    const session = createReadSession({ maxAge: 60 });
    const obs = await observeRemote(withToken, { cacheDir, session });
    await readRemoteFile(withToken, obs.commit, "oats-package/oats-package.json", { cacheDir, session });
    const entry = { version: "1.0.0", source: "git:example.invalid/org/pkg@v1", url: withToken, commit: obs.commit, integrity: "sha256-x", path: "oats-package", capabilities: ["pc"] };
    await lockedPackageCapabilities("fx.pkg", entry, { remoteOptions: { cacheDir, session } });
    await session.close();
    assert.equal((await observeRemote(withToken, { cacheDir, session: createReadSession({ maxAge: 60 }) })).reused, true);
  } finally { restore(); }
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) walk(p); else if (n.isFile()) files.push(p); } };
  walk(cacheDir);
  assert.ok(files.some((f) => f.includes(".observed")) && files.some((f) => f.includes(".parsed")) && files.some((f) => f.endsWith("oats-remote.json")));
  for (const f of files) assert.ok(!readFileSync(f).includes("s3cr3t-t0ken"), `${f} carries the credential`);
});

test("session.observation(): the OLDEST head used and whether any was reused; no head observed → the time the session began", async () => {
  const base = scratch(), a = repo(base, "a"), b = repo(base, "b"), cacheDir = join(base, "cache");
  const empty = createReadSession({ maxAge: 60 });
  assert.deepEqual(empty.observation(), { observedAt: empty.startedAt, reused: false });
  await observeRemote(a.bare, { cacheDir, session: createReadSession() });
  await observeRemote(b.bare, { cacheDir, session: createReadSession() });
  const old = ago(30_000);
  setObservedAt(cacheDir, a, old);        // a: fresh enough, reused with its recorded time
  setObservedAt(cacheDir, b, ago(120_000)); // b: expired, observed live now
  const session = createReadSession({ maxAge: 60 });
  await observeRemote(a.bare, { cacheDir, session });
  await observeRemote(b.bare, { cacheDir, session });
  await observeRemote(a.bare, { at: a.commit, cacheDir, session }); // a pinned read: never counted
  assert.deepEqual(session.observation(), { observedAt: old, reused: true });
});

test("a member whose objects were pruned after its entries were written: the hit still answers without git; a miss refetches as today", async () => {
  const base = scratch(), cacheDir = join(base, "cache");
  const hostRef = pathToFileURL(join(base, "host.git")).href;
  const member = repo(base, "member", { "oats-membership.yaml": { schemaVersion: 2, workspace: hostRef }, "souls/dev/soul.yaml": { schemaVersion: 2, name: "dev", description: "d", work: "directory" } });
  const host = repo(base, "host", { "oats-workspace.yaml": { schemaVersion: 2, name: "p", members: [member.ref] } });
  const first = createReadSession();
  const d1 = await discoverWorkspace(host.ref, { local: {}, remoteOptions: { cacheDir, session: first } });
  await first.close();
  const memberCache = join(cacheDir, sha256(member.key));
  for (const d of ["pack", ...readdirSync(join(memberCache, "objects")).filter((n) => /^[0-9a-f]{2}$/.test(n))]) rmSync(join(memberCache, "objects", d), { recursive: true, force: true });
  mkdirSync(join(memberCache, "objects", "pack"), { recursive: true });
  const { exec, calls } = counting();
  const second = createReadSession({ maxAge: 60 });
  const d2 = await discoverWorkspace(host.ref, { local: {}, remoteOptions: { cacheDir, exec, session: second } });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(d2)), JSON.parse(JSON.stringify(d1)));
  assert.deepEqual(calls, [], "reused heads and parsed entries: no git process");
  // A read the cache does not hold: the pruned store is detected and refetched.
  const bytes = await readRemoteFile(member.ref, member.commit, "souls/dev/soul.yaml", { cacheDir, exec, session: second });
  assert.match(bytes.bytes.toString(), /name: dev/);
  assert.ok(calls.includes("fetch"));
  await second.close();
});
