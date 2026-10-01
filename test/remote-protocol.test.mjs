/** lib/remote.mjs observeLive: a HEAD observation speaks protocol v0 (one round trip) unless the operator pinned
 *  `protocol.version`; tags and branches keep today's v2 argv. The answer, the observation records and the memo
 *  keys are v2's. A v0 advertisement over budget is observed under v2, recorded for the remote and said once; a
 *  final v0 failure (timeout, auth, not-found, cache, an abort) is today's error with no retry; any other is
 *  retried once under v2. Real bare repos; ls-remote intercepted where a failure is injected, and a real
 *  smart-HTTP server (`git http-backend`) for the wire. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { createReadSession, observeRemote, runGit, V0_ADVERTISEMENT_BUDGET } from "../lib/remote.mjs";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
const roots = [];
function scratch() { const d = mkdtempSync(join(tmpdir(), "oats-protocol-")); roots.push(d); return d; }
test.after(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });

/** The tests own git's configuration: no operator pin leaks in, and each test sets what it means to. */
const savedEnv = {};
for (const k of ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_CONFIG_KEY_1", "GIT_CONFIG_VALUE_1"]) savedEnv[k] = process.env[k];
function gitConfigEnv(env) {
  for (const k of Object.keys(savedEnv)) delete process.env[k];
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: "1" }, env);
}
test.beforeEach(() => gitConfigEnv({}));
test.after(() => { for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

/** A bare repo whose HEAD is `trunk` (not main), with other branches and an annotated tag. */
function fixture({ branches = 2 } = {}) {
  const base = scratch();
  const bare = join(base, "remote.git"), work = join(base, "work");
  git(base, "init", "-q", "--bare", "-b", "trunk", bare);
  git(bare, "config", "uploadpack.allowFilter", "true");
  git(bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  git(base, "init", "-q", "-b", "trunk", work);
  writeFileSync(join(work, "README.md"), "# one\n");
  git(work, "add", "-A"); git(work, "commit", "-q", "-m", "one");
  git(work, "tag", "-a", "v1", "-m", "v1");
  for (let i = 0; i < branches; i++) git(work, "branch", `side-${String(i).padStart(4, "0")}`);
  git(work, "push", "-q", "--all", bare); git(work, "push", "-q", "--tags", bare);
  return { base, bare, work, commit: git(work, "rev-parse", "HEAD"), cacheDir: join(base, "cache") };
}
const cacheRepoOf = (f) => join(f.cacheDir, createHash("sha256").update(`local/${f.bare}`).digest("hex"));
const recordOf = (f) => join(f.cacheDir, ".ls-remote", `${createHash("sha256").update(`local/${f.bare}`).digest("hex")}.json`);
const readRecord = (f) => JSON.parse(readFileSync(recordOf(f), "utf8"));
const caught = (promise) => promise.then(() => assert.fail("expected a refusal"), (e) => e);
const plain = (obs) => { const { observedAt, ...rest } = obs; assert.equal(typeof observedAt, "string"); return rest; };
const errorShape = (e) => ({ code: e.code, message: e.message, details: e.details });

/** An exec over the real git: `protocol.version` answered as `pinned` says (unset → exit 1), every ls-remote
 *  recorded (`protocol`: 0 for the v0 argv, 2 otherwise) and answered by `v0`/`v2` when given. */
function intercepting({ pinned = false, v0 = null, v2 = null } = {}) {
  const lsRemote = [];
  const exec = (args, opts = {}) => {
    if (args[0] === "config" && args.includes("protocol.version")) {
      if (pinned === "fails") return Promise.reject(Object.assign(new Error("boom"), { code: 128, stderr: Buffer.from("fatal: bad config") }));
      return pinned ? Promise.resolve({ stdout: Buffer.from(`${pinned}\n`), stderr: Buffer.alloc(0) })
        : Promise.reject(Object.assign(new Error("unset"), { code: 1, stderr: Buffer.alloc(0) }));
    }
    if (args.includes("ls-remote")) {
      const protocol = args.includes("protocol.version=0") ? 0 : 2;
      lsRemote.push({ protocol, args, maxBuffer: opts.maxBuffer });
      const answer = protocol === 0 ? v0 : v2;
      if (answer) return answer(args, opts);
    }
    return runGit(args, opts);
  };
  return { exec, lsRemote };
}
const failure = (stderr, extra = {}) => () => Promise.reject(Object.assign(new Error(`Command failed\n${stderr}`), { code: 128, signal: null, killed: false, timedOut: false, overflowed: false, stdout: Buffer.alloc(0), stderr: Buffer.from(stderr), ...extra }));

test("a HEAD observation speaks v0 when unpinned: no HEAD pattern, the advertisement bounded; the answer is v2's, HEAD's symref included", async () => {
  const f = fixture();
  const v0 = intercepting();
  const viaV0 = await observeRemote(f.bare, { cacheDir: f.cacheDir, exec: v0.exec });
  assert.deepEqual(v0.lsRemote.map((c) => [c.args, c.maxBuffer]), [[["-c", "protocol.version=0", "ls-remote", "--symref", f.bare], V0_ADVERTISEMENT_BUDGET]]);
  assert.equal(V0_ADVERTISEMENT_BUDGET, 4 * 1024 * 1024);
  const v2 = intercepting({ pinned: "2" });
  const viaV2 = await observeRemote(f.bare, { cacheDir: join(f.base, "cache2"), exec: v2.exec });
  assert.deepEqual(v2.lsRemote.map((c) => c.args), [["ls-remote", "--symref", f.bare, "HEAD"]]);
  assert.deepEqual(plain(viaV0), plain(viaV2));
  assert.deepEqual(plain(viaV0), { key: `local/${f.bare}`, url: f.bare, commit: f.commit, ref: "refs/heads/trunk" });
  for (const at of [undefined, null, "", "HEAD"]) {
    const t = intercepting();
    await observeRemote(f.bare, { cacheDir: f.cacheDir, exec: t.exec, at });
    assert.deepEqual(t.lsRemote.map((c) => c.protocol), [0], `at ${JSON.stringify(at)} is a HEAD observation`);
  }
});

test("a pinned protocol.version (any value, from env, global or system config) keeps today's argv; so does a read that fails", async () => {
  const f = fixture();
  for (const pinned of ["2", "0", "1", "fails"]) {
    const t = intercepting({ pinned });
    await observeRemote(f.bare, { cacheDir: f.cacheDir, exec: t.exec });
    assert.deepEqual(t.lsRemote.map((c) => c.args), [["ls-remote", "--symref", f.bare, "HEAD"]], `pinned ${pinned}`);
  }
  // Each place an operator pins it, read by the real git in the observation's own environment.
  const file = (name, text) => { const p = join(f.base, name); writeFileSync(p, text); return p; };
  const sources = {
    env: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "protocol.version", GIT_CONFIG_VALUE_0: "2" },
    global: { GIT_CONFIG_GLOBAL: file("global", "[protocol]\n\tversion = 2\n") },
    system: { GIT_CONFIG_NOSYSTEM: "", GIT_CONFIG_SYSTEM: file("system", "[protocol]\n\tversion = 1\n") },
    unpinned: {},
  };
  for (const [source, env] of Object.entries(sources)) {
    gitConfigEnv(env);
    if (env.GIT_CONFIG_NOSYSTEM === "") delete process.env.GIT_CONFIG_NOSYSTEM;
    const calls = [];
    const exec = (args, opts) => { if (args.includes("ls-remote")) calls.push(args); return runGit(args, opts); };
    await observeRemote(f.bare, { cacheDir: f.cacheDir, exec });
    assert.deepEqual(calls, [source === "unpinned" ? ["-c", "protocol.version=0", "ls-remote", "--symref", f.bare] : ["ls-remote", "--symref", f.bare, "HEAD"]], source);
  }
});

test("tag and branch observations keep today's argv and protocol, unpinned too", async () => {
  const f = fixture();
  for (const at of ["v1", "side-0001", "trunk"]) {
    const t = intercepting();
    const obs = await observeRemote(f.bare, { cacheDir: f.cacheDir, exec: t.exec, at });
    assert.deepEqual(t.lsRemote.map((c) => c.args), [["ls-remote", "--symref", f.bare, `refs/tags/${at}`, `refs/tags/${at}^{}`, `refs/heads/${at}`, at]]);
    assert.equal(obs.commit, f.commit);
  }
});

test("an advertisement over budget: git is killed, the remote observed under v2, recorded and said once; the next command goes straight to v2", async () => {
  const f = fixture({ branches: 40 });
  const t = intercepting();
  const session = createReadSession({ v0AdvertisementBudget: 512 });
  const obs = await observeRemote(f.bare, { cacheDir: f.cacheDir, exec: t.exec, session });
  assert.deepEqual(t.lsRemote.map((c) => c.protocol), [0, 2]);
  assert.equal(t.lsRemote[0].maxBuffer, 512);
  assert.deepEqual(plain(obs), { key: `local/${f.bare}`, url: f.bare, commit: f.commit, ref: "refs/heads/trunk" });
  assert.deepEqual(session.notices, [`${f.bare} sends a ref advertisement over 512 bytes; OATS observes it with protocol v2`]);
  const rec = readRecord(f);
  assert.deepEqual([rec.protocol, rec.reason, typeof rec.recordedAt], ["v2", "overflow", "string"]);
  await session.close();
  // The next command: v2 at once, nothing said.
  const next = intercepting();
  const later = createReadSession({ v0AdvertisementBudget: 512 });
  await observeRemote(f.bare, { cacheDir: f.cacheDir, exec: next.exec, session: later });
  assert.deepEqual(next.lsRemote.map((c) => c.protocol), [2]);
  assert.deepEqual(later.notices, []);
  await later.close();
  // An overflow record never expires.
  writeFileSync(recordOf(f), JSON.stringify({ ...rec, recordedAt: "2020-01-01T00:00:00.000Z" }));
  const old = intercepting();
  await observeRemote(f.bare, { cacheDir: f.cacheDir, exec: old.exec, session: createReadSession({ v0AdvertisementBudget: 512 }) });
  assert.deepEqual(old.lsRemote.map((c) => c.protocol), [2]);
  // A wiped cache forgets it.
  rmSync(f.cacheDir, { recursive: true, force: true });
  const fresh = intercepting();
  await observeRemote(f.bare, { cacheDir: f.cacheDir, exec: fresh.exec });
  assert.deepEqual(fresh.lsRemote.map((c) => c.protocol), [0], "the default budget reads it whole");
});

test("a final v0 failure (timeout, auth, not-found, cache, an abort) is today's error, reason and details, with no v2 retry", async () => {
  const f = fixture();
  const cases = {
    timeout: failure("", { code: null, killed: true, signal: "SIGTERM", timedOut: true }),
    auth: failure("fatal: Authentication failed for 'https://example.invalid/'"),
    "not-found": failure("fatal: repository 'https://example.invalid/x.git/' not found"),
    cache: failure("error: could not lock config file /tmp/x/config: File exists"),
    abort: () => Promise.reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError", code: "ABORT_ERR", overflowed: false, timedOut: false })),
  };
  for (const [name, answer] of Object.entries(cases)) {
    const cacheDir = join(f.base, `cache-${name}`);
    const unpinned = intercepting({ v0: answer, v2: () => assert.fail(`${name}: no v2 retry`) });
    const e0 = await caught(observeRemote(f.bare, { cacheDir, exec: unpinned.exec }));
    assert.deepEqual(unpinned.lsRemote.map((c) => c.protocol), [0], name);
    const pinned = intercepting({ pinned: "2", v2: answer });
    const e2 = await caught(observeRemote(f.bare, { cacheDir: join(f.base, `cache-${name}-v2`), exec: pinned.exec }));
    assert.deepEqual(errorShape(e0), errorShape(e2), `${name}: exactly today's error`);
    if (name !== "abort") assert.equal(e0.details.reason, name);
    assert.equal(existsSync(join(cacheDir, ".ls-remote")), name === "timeout", `${name}: only a timeout is recorded`);
  }
  // A session closed while v0 runs: no retry, no record, today's abort.
  const session = createReadSession();
  const t = intercepting({ v0: (args, opts) => new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError", code: "ABORT_ERR" })))) });
  const pending = caught(observeRemote(f.bare, { cacheDir: f.cacheDir, exec: t.exec, session }));
  await new Promise((r) => setTimeout(r, 50));
  await session.close();
  assert.equal((await pending).code, "E_REMOTE_UNREADABLE");
  assert.deepEqual(t.lsRemote.map((c) => c.protocol), [0]);
  assert.equal(existsSync(recordOf(f)), false, "an abort records nothing");
});

test("a v0 timeout records v2 for 7 days and says so: the next command goes straight to v2; an expired, corrupt or unknown record is no record", async () => {
  const f = fixture();
  const timeout = failure("", { code: null, killed: true, signal: "SIGTERM", timedOut: true });
  const session = createReadSession();
  const e = await caught(observeRemote(f.bare, { cacheDir: f.cacheDir, exec: intercepting({ v0: timeout, v2: () => assert.fail("no v2 retry") }).exec, session }));
  await session.close();
  assert.deepEqual([e.code, e.details.reason], ["E_REMOTE_UNREADABLE", "timeout"]);
  assert.deepEqual(session.notices, [`${f.bare} timed out under protocol v0; OATS observes it with protocol v2 for 7 days`]);
  const rec = readRecord(f);
  assert.deepEqual(Object.keys(rec).sort(), ["protocol", "reason", "recordedAt"]);
  assert.deepEqual([rec.protocol, rec.reason], ["v2", "timeout"]);
  assert.ok(Math.abs(Date.parse(rec.recordedAt) - Date.now()) < 60_000);
  // Within the week: v2 at once, nothing said.
  const next = intercepting(), later = createReadSession();
  await observeRemote(f.bare, { cacheDir: f.cacheDir, exec: next.exec, session: later });
  await later.close();
  assert.deepEqual(next.lsRemote.map((c) => c.protocol), [2]);
  assert.deepEqual(later.notices, []);
  // Each of these is no record: v0 is tried again.
  const DAY = 24 * 3600 * 1000;
  const noRecord = {
    expired: JSON.stringify({ protocol: "v2", reason: "timeout", recordedAt: new Date(Date.now() - 7 * DAY - 60_000).toISOString() }),
    future: JSON.stringify({ protocol: "v2", reason: "timeout", recordedAt: new Date(Date.now() + DAY).toISOString() }),
    "unknown reason": JSON.stringify({ protocol: "v2", reason: "slow", recordedAt: new Date().toISOString() }),
    "no protocol": JSON.stringify({ reason: "overflow", recordedAt: new Date().toISOString() }),
    corrupt: "{ not json",
  };
  for (const [what, text] of Object.entries(noRecord)) {
    writeFileSync(recordOf(f), text);
    const t = intercepting();
    await observeRemote(f.bare, { cacheDir: f.cacheDir, exec: t.exec });
    assert.deepEqual(t.lsRemote.map((c) => c.protocol), [0], what);
  }
  // Six days old: still v2.
  writeFileSync(recordOf(f), JSON.stringify({ protocol: "v2", reason: "timeout", recordedAt: new Date(Date.now() - 6 * DAY).toISOString() }));
  const recent = intercepting();
  await observeRemote(f.bare, { cacheDir: f.cacheDir, exec: recent.exec });
  assert.deepEqual(recent.lsRemote.map((c) => c.protocol), [2]);
});

test("any other v0 failure is retried once under v2: said once, never recorded; a failed retry is its own error", async () => {
  const f = fixture();
  const others = {
    network: failure("fatal: unable to access 'https://example.invalid/': Could not resolve host: example.invalid"),
    killed: failure("", { code: null, signal: "SIGKILL" }),
    unknown: failure("fatal: protocol error: bad line length character"),
  };
  for (const [reason, answer] of Object.entries(others)) {
    const session = createReadSession();
    const t = intercepting({ v0: answer });
    const obs = await observeRemote(f.bare, { cacheDir: f.cacheDir, exec: t.exec, session });
    assert.deepEqual(t.lsRemote.map((c) => c.protocol), [0, 2], reason);
    assert.equal(obs.commit, f.commit);
    assert.deepEqual(session.notices, [`${f.bare} failed under protocol v0 (${reason === "unknown" ? "network" : reason}); observed with protocol v2`]);
    assert.equal(existsSync(recordOf(f)), false, "a retried failure is not recorded");
    await session.close();
  }
  // Said once per remote per command, however many observations of it the command makes.
  const session = createReadSession();
  for (const cacheDir of [join(f.base, "c1"), join(f.base, "c2")]) await observeRemote(f.bare, { cacheDir, exec: intercepting({ v0: others.network }).exec, session });
  assert.equal(session.notices.length, 1);
  await session.close();
  // The v2 retry fails: its own classification is the error, exactly as today.
  const retried = intercepting({ v0: others.network, v2: failure("fatal: Authentication failed") });
  const e0 = await caught(observeRemote(f.bare, { cacheDir: f.cacheDir, exec: retried.exec }));
  const today = intercepting({ pinned: "2", v2: failure("fatal: Authentication failed") });
  const e2 = await caught(observeRemote(f.bare, { cacheDir: f.cacheDir, exec: today.exec }));
  assert.deepEqual(errorShape(e0), errorShape(e2));
  assert.equal(e0.details.reason, "auth");
});

test("an empty remote is not-found and a detached HEAD has no ref, under v0 exactly as under v2", async () => {
  const base = scratch();
  const empty = join(base, "empty.git");
  git(base, "init", "-q", "--bare", empty);
  const v0 = intercepting(), v2 = intercepting({ pinned: "2" });
  const e0 = await caught(observeRemote(empty, { cacheDir: join(base, "cache"), exec: v0.exec }));
  const e2 = await caught(observeRemote(empty, { cacheDir: join(base, "cache"), exec: v2.exec }));
  assert.deepEqual(errorShape(e0), errorShape(e2));
  assert.equal(e0.details.reason, "not-found");
  assert.deepEqual(v0.lsRemote.map((c) => c.protocol), [0], "no v2 retry");
  const f = fixture();
  writeFileSync(join(f.bare, "HEAD"), `${f.commit}\n`); // detached
  const d0 = await observeRemote(f.bare, { cacheDir: f.cacheDir, exec: intercepting().exec });
  const d2 = await observeRemote(f.bare, { cacheDir: f.cacheDir, exec: intercepting({ pinned: "2" }).exec });
  assert.deepEqual(plain(d0), plain(d2));
  assert.equal(d0.ref, null);
});

test("the observation records and the session's memo keys are byte-identical between v0 and v2", async () => {
  const f = fixture();
  const run = async (pinned) => {
    const cacheDir = join(f.base, `cache-${pinned ? "v2" : "v0"}`);
    const session = createReadSession();
    await observeRemote(f.bare, { cacheDir, exec: intercepting({ pinned }).exec, session });
    const dir = join(cacheDir, ".observed");
    const files = readdirSync(dir);
    const records = files.map((n) => { const { observedAt, ...rest } = JSON.parse(readFileSync(join(dir, n), "utf8")); return [n, rest]; });
    const keys = [...session.observations.keys()].map((k) => k.replace(cacheDir, "<cache>"));
    await session.close();
    return { records, keys };
  };
  assert.deepEqual(await run(false), await run("2"));
});

/** A smart-HTTP server: `git http-backend` behind a Node http server, every request logged as
 *  { method, path, protocol } (the Git-Protocol header: "version=2" for v2). `serve(req, res, url)`
 *  answers a request itself when it returns true. */
async function smartHttp(projectRoot, { serve = null } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    requests.push({ method: req.method, path: url.pathname, protocol: req.headers["git-protocol"] ?? null });
    if (serve?.(req, res, url)) return;
    const cgi = spawn("git", ["http-backend"], { env: { ...GIT_ENV, GIT_PROJECT_ROOT: projectRoot, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: url.pathname,
      REQUEST_METHOD: req.method, QUERY_STRING: url.search.slice(1), CONTENT_TYPE: req.headers["content-type"] ?? "", REMOTE_ADDR: "127.0.0.1",
      ...(req.headers["git-protocol"] ? { GIT_PROTOCOL: req.headers["git-protocol"], HTTP_GIT_PROTOCOL: req.headers["git-protocol"] } : {}) } });
    req.pipe(cgi.stdin);
    const chunks = [];
    cgi.stdout.on("data", (c) => chunks.push(c));
    cgi.on("close", () => {
      const out = Buffer.concat(chunks);
      const split = out.indexOf("\r\n\r\n") >= 0 ? out.indexOf("\r\n\r\n") : out.indexOf("\n\n");
      const sep = out.indexOf("\r\n\r\n") >= 0 ? 4 : 2;
      const headers = out.subarray(0, split).toString("utf8").split(/\r?\n/);
      let status = 200;
      for (const h of headers) {
        const [k, ...v] = h.split(":");
        if (/^status$/i.test(k)) status = Number(v.join(":").trim().split(" ")[0]);
        else if (k) res.setHeader(k.trim(), v.join(":").trim());
      }
      res.statusCode = status;
      res.end(out.subarray(split + sep));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { port: server.address().port, requests, close: () => server.close() };
}

test("over real smart HTTP: v0 is one GET where v2 is a GET and a POST, and both observe the same commit and symref; an advertisement over a lowered budget falls back", async () => {
  const f = fixture({ branches: 60 });
  const http = await smartHttp(f.base);
  try {
    // The operator's own git config reaches the remote (insteadOf), as any credential or proxy setting would.
    const route = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.http://127.0.0.1:${http.port}/.insteadOf`, GIT_CONFIG_VALUE_0: "https://smart.example/org/" };
    const url = "https://smart.example/org/remote";
    gitConfigEnv(route);
    const start = http.requests.length;
    // One session per observation, as one command each: protocol.version is read once per command.
    const viaV0 = await observeRemote(url, { cacheDir: join(f.base, "h0"), session: createReadSession() });
    const lsV0 = http.requests.slice(start).filter((r) => r.path.endsWith("/info/refs") || r.path.endsWith("/git-upload-pack"));
    assert.equal(lsV0[0].method, "GET");
    assert.notEqual(lsV0[0].protocol, "version=2", "v0: no v2 request");
    assert.equal(lsV0.filter((r) => r.path.endsWith("/info/refs")).length, 1 + 1, "one advertisement for ls-remote, one for the fetch");
    gitConfigEnv({ ...route, GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_1: "protocol.version", GIT_CONFIG_VALUE_1: "2" });
    const mark = http.requests.length;
    const viaV2 = await observeRemote(url, { cacheDir: join(f.base, "h2"), session: createReadSession() });
    const lsV2 = http.requests.slice(mark, mark + 2);
    assert.deepEqual(lsV2.map((r) => [r.method, r.protocol]), [["GET", "version=2"], ["POST", "version=2"]], "v2: advertisement, then ls-refs");
    assert.deepEqual(plain(viaV0), plain(viaV2));
    assert.deepEqual([viaV0.commit, viaV0.ref], [f.commit, "refs/heads/trunk"]);
    // Over a lowered budget: the partial v0 read, then v2, recorded and said once.
    gitConfigEnv(route);
    const session = createReadSession({ v0AdvertisementBudget: 1024 });
    const fallback = await observeRemote(url, { cacheDir: join(f.base, "h3"), session });
    await session.close();
    assert.deepEqual(plain(fallback), plain(viaV2));
    assert.deepEqual(session.notices, ["https://smart.example/org/remote.git sends a ref advertisement over 1024 bytes; OATS observes it with protocol v2"]);
    assert.equal(JSON.parse(readFileSync(join(f.base, "h3", ".ls-remote", `${createHash("sha256").update("smart.example/org/remote").digest("hex")}.json`), "utf8")).reason, "overflow");
  } finally { http.close(); }
});

test("the budget bounds what OATS keeps, not the wire: git reads a whole advertisement before printing it, so an over-budget one costs one transfer, then the kill, v2 and the record", async () => {
  const f = fixture();
  // A v0 advertisement of ~5.5 MB whose final flush is withheld: git prints nothing until it has read it all.
  const pkt = (s) => (Buffer.byteLength(s) + 4).toString(16).padStart(4, "0") + s;
  const oid = "a".repeat(40);
  const ad = pkt("# service=git-upload-pack\n") + "0000" + pkt(`${oid} HEAD\0symref=HEAD:refs/heads/main\n`)
    + Array.from({ length: 80000 }, (_, i) => pkt(`${oid} refs/heads/branch-${i}\n`)).join("");
  assert.ok(Buffer.byteLength(ad) > V0_ADVERTISEMENT_BUDGET);
  let sent = 0, flushed = false;
  const http = await smartHttp(f.base, {
    serve: (req, res, url) => {
      if (req.method !== "GET" || !url.pathname.endsWith("/info/refs") || req.headers["git-protocol"] === "version=2") return false;
      res.writeHead(200, { "Content-Type": "application/x-git-upload-pack-advertisement", "Cache-Control": "no-cache" });
      res.write(ad, () => { sent = Buffer.byteLength(ad); setTimeout(() => { flushed = true; res.end("0000"); }, 500); });
      return true;
    },
  });
  try {
    gitConfigEnv({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.http://127.0.0.1:${http.port}/.insteadOf`, GIT_CONFIG_VALUE_0: "https://huge.example/org/" });
    const session = createReadSession();
    const obs = await observeRemote("https://huge.example/org/remote", { cacheDir: join(f.base, "cache-huge"), session });
    await session.close();
    assert.equal(sent, Buffer.byteLength(ad), "the whole advertisement crossed the wire");
    assert.equal(flushed, true, "git overflowed only once the advertisement was complete");
    assert.deepEqual([obs.commit, obs.ref], [f.commit, "refs/heads/trunk"], "observed under v2");
    assert.deepEqual(session.notices, ["https://huge.example/org/remote.git sends a ref advertisement over 4 MiB; OATS observes it with protocol v2"]);
    const record = join(f.base, "cache-huge", ".ls-remote", `${createHash("sha256").update("huge.example/org/remote").digest("hex")}.json`);
    assert.equal(JSON.parse(readFileSync(record, "utf8")).reason, "overflow");
    // Paid once: the next command asks for v2 only.
    const mark = http.requests.length;
    await observeRemote("https://huge.example/org/remote", { cacheDir: join(f.base, "cache-huge"), session: createReadSession() });
    assert.ok(http.requests.slice(mark).every((r) => r.protocol === "version=2"), "no second v0 advertisement");
  } finally { http.close(); }
});
