// The warm reader's protocol (awebai/oats#1630; docs/desktop-cli-api.md "The warm reader"; lib/reader.mjs).
// `oats reader --stdio` is a client's child: a hello line once every module the two reads use is loaded, then
// one answer or refusal per request line, in order. Its accepted requests answer exactly what the CLI prints and
// exits with for the same argv (cwd = --dir): a client cannot tell the warm path from its CLI fallback. What it
// cannot answer that way is a refusal frame with one of the E_READER_* codes, never an answer. Pinned here: the
// usage error, PRELOAD against the reads' lazy imports (statically and in a live reader), a good request of each
// read, the bad-request and unsupported refusals, the CLI's own answers for --team and a bad --max-age, the line
// limit, ids, unknown keys and in-order answers to requests sent together. Lifetime: reader-lifetime.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import module from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hotLeaves, hotRead } from "../lib/hot-reads.mjs";
import { LINE_LIMIT, PRELOAD } from "../lib/reader.mjs";
import { OATS_VERSION } from "../lib/version.mjs";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const rel = (file) => relative(ROOT, file).split("\\").join("/");
const NO_HOOKS = typeof module.registerHooks !== "function" && "module.registerHooks is newer than this Node";

/** A reader child on `env`, ended with `fx` if still running: `next()` is its next stdout line as a frame, `send(...)` writes request lines (an
 *  object is JSON-encoded; a string is sent as it is) in one write, `end()` closes stdin and waits for its exit. */
function startReader(fx, env, { nodeArgs = [] } = {}) {
  const child = spawn(process.execPath, [...nodeArgs, CLI, "reader", "--stdio"], { env, stdio: ["pipe", "pipe", "pipe"] });
  const r = { child, lines: [], stderr: "", exit: null };
  // A test that fails with its reader running ends it before the fixture's leftover check.
  fx.beforeCleanup(() => { if (!r.exit) child.kill("SIGTERM"); });
  let buf = "", read = 0, waiters = [];
  const wake = () => { for (const w of waiters.splice(0)) w(); };
  child.stdin.on("error", () => { /* the reader is gone: what it answered is asserted */ });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => { buf += d; for (let nl; (nl = buf.indexOf("\n")) !== -1;) { r.lines.push(buf.slice(0, nl)); buf = buf.slice(nl + 1); } wake(); });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => { r.stderr += d; });
  r.exited = new Promise((done) => child.on("close", (code, signal) => { r.exit = { code, signal }; wake(); done(r.exit); }));
  r.next = async (ms = 60_000) => {
    const deadline = Date.now() + ms;
    while (read >= r.lines.length) {
      if (r.exit) assert.fail(`the reader exited (${JSON.stringify(r.exit)}) before its next line\n${r.stderr}`);
      if (Date.now() > deadline) assert.fail(`no line from the reader in ${ms} ms\n${r.stderr}`);
      await new Promise((w) => { waiters.push(w); setTimeout(w, 100); });
    }
    return JSON.parse(r.lines[read++]);
  };
  r.send = (...requests) => child.stdin.write(requests.map((q) => `${typeof q === "string" ? q : JSON.stringify(q)}\n`).join(""));
  r.end = () => { child.stdin.end(); return r.exited; };
  return r;
}
/** Start a reader and take its hello, which must be its first line. */
async function helloed(fx, env, opts) {
  const r = startReader(fx, env, opts);
  assert.deepEqual(await r.next(), { readerApi: 1, version: OATS_VERSION, reads: ["status", "workspace status"] });
  return r;
}

/** A refusal frame: exactly `{ id, refused: { code, message } }`. */
function assertRefused(frame, id, code) {
  assert.deepEqual(Object.keys(frame).sort(), ["id", "refused"], JSON.stringify(frame));
  assert.equal(frame.id, id, JSON.stringify(frame));
  assert.equal(frame.refused.code, code, JSON.stringify(frame));
  assert.deepEqual(Object.keys(frame.refused).sort(), ["code", "message"]);
  assert.ok(typeof frame.refused.message === "string" && frame.refused.message.length > 0);
}
/** The observation time is the one fact two reads of an unchanged deployment do not share. */
const timeless = (value) => JSON.parse(JSON.stringify(value), (key, v) => (key === "observedAt" && typeof v === "string" ? "<observedAt>" : v));
/** An answer frame equals the CLI run of the same argv with cwd = --dir: `exit` and `answer` (stderr is outside
 *  the equivalence). */
function assertCliAnswer(fx, frame, id, argv, cwd = fx.dep) {
  assert.ok(!("refused" in frame), `${argv.join(" ")} was refused: ${JSON.stringify(frame)}`);
  assert.deepEqual(Object.keys(frame).filter((k) => k !== "stderr").sort(), ["answer", "exit", "id"], JSON.stringify(frame));
  assert.equal(frame.id, id);
  if ("stderr" in frame) assert.equal(typeof frame.stderr, "string");
  const cli = fx.cli(argv, { cwd });
  assert.equal(frame.exit, cli.status, `${argv.join(" ")}: exit\n${cli.stderr}`);
  assert.deepEqual(timeless(frame.answer), timeless(JSON.parse(cli.stdout)), `${argv.join(" ")}: answer`);
}

test("bare `oats reader` and `oats reader --json` are E_USAGE, exit 1", { timeout: 60_000 }, (t) => {
  const fx = v2Deployment({ t });
  const text = fx.cli(["reader"]);
  assert.equal(text.status, 1, text.stderr);
  assert.equal(text.stdout, "");
  assert.match(text.stderr, /usage: oats reader --stdio/);
  const json = fx.cli(["reader", "--json"]);
  assert.equal(json.status, 1, json.stderr);
  const doc = JSON.parse(json.stdout);
  assert.equal(doc.ok, false);
  assert.equal(doc.error.code, "E_USAGE");
  assert.match(doc.error.message, /oats reader --stdio/);
});

/** The modules the two reads can load, from their hot-read leaves (lib/hot-reads.mjs): `all`, by static imports
 *  and literal `import()`s (test/read-call-state.test.mjs readClosure), `statically` by static imports only, and
 *  `lazy`, each literal `import()` target. */
function readGraph() {
  const roots = new Set();
  for (const argv of [["status"], ["workspace", "status"]]) {
    const read = hotRead(argv);
    for (const line of Object.keys(read.lines)) for (const leaf of hotLeaves(read, line)) roots.add(join(ROOT, "lib", `${leaf}.mjs`));
  }
  const walk = (withLazy) => {
    const seen = new Set(), lazy = new Set(), queue = [...roots];
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      // A specifier that is not one literal would hide a module from this scan.
      assert.doesNotMatch(source, /\bimport\s*\(\s*(?!["'])/, `${rel(file)} imports a module by a non-literal specifier`);
      for (const m of source.matchAll(/(?:\bfrom\s*|^import\s+)["'](\.{1,2}\/[^"']+)["']/gm)) queue.push(resolve(dirname(file), m[1]));
      for (const m of source.matchAll(/\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']/g)) {
        lazy.add(resolve(dirname(file), m[1]));
        if (withLazy) queue.push(resolve(dirname(file), m[1]));
      }
    }
    return { seen, lazy };
  };
  const statically = walk(false).seen, { seen: all, lazy } = walk(true);
  return { all, statically, lazy: new Set([...lazy].filter((f) => all.has(f))) };
}

test("PRELOAD names every module the reads reach only by a lazy import, and loads that module", () => {
  const { all, statically, lazy } = readGraph();
  assert.ok(statically.size > 20, "the closure was read");
  for (const m of ["lib/roster-read.mjs", "lib/workspace-read.mjs", "lib/read-call.mjs"]) assert.ok(statically.has(join(ROOT, m)), `${m} is a static import of the reads`);
  // A module the reads reach only through an `import()` would load during a request, after the hello.
  const onlyLazy = [...all].filter((f) => !statically.has(f)).map(rel).sort();
  const missing = onlyLazy.filter((m) => !(m.replace(/^lib\//, "").replace(/\.mjs$/, "") in PRELOAD));
  assert.deepEqual(missing, [], `the reads load these lazily: add them to lib/reader.mjs PRELOAD: ${missing.join(", ")}`);
  assert.ok(onlyLazy.length > 0, "the scan found the reads' lazy imports");
  // No entry outlives its import: each is a lazy import of the reads, and its loader imports that module.
  const lazyNames = new Set([...lazy].map(rel));
  for (const [key, load] of Object.entries(PRELOAD)) {
    assert.ok(lazyNames.has(`lib/${key}.mjs`), `PRELOAD ${key}: the reads import lib/${key}.mjs lazily no longer (remove it)`);
    assert.match(String(load), new RegExp(`import\\(\\s*["']\\./${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.mjs["']\\s*\\)`), `PRELOAD ${key} imports ./${key}.mjs`);
  }
});

test("the hello comes first, once every module is loaded; a status and a workspace status read answer what the CLI does", { skip: NO_HOOKS, timeout: 180_000 }, async (t) => {
  const fx = v2Deployment({ t });
  await fx.spawn("dev", { instance: "dev-one" }); // an instance: status reads its drift (lib/drift.mjs, lazily)
  // A hook that records every module file loaded, and how many were loaded when the first stdout line was written.
  // End to end, whatever loads them: today bin/oats.mjs's static imports (lib/core.mjs's closure) load the reads'
  // lazy modules before lib/reader.mjs runs, so PRELOAD itself is pinned by the scan above, not here.
  const hook = join(fx.base, "loads.mjs"), record = join(fx.base, "loads.json");
  writeFileSync(hook, [
    'import module from "node:module";',
    'import { writeFileSync } from "node:fs";',
    "const loaded = [];",
    "let atHello = null;",
    'module.registerHooks({ load(url, context, nextLoad) { if (url.startsWith("file:")) loaded.push(url); return nextLoad(url, context); } });',
    "const write = process.stdout.write;",
    "process.stdout.write = function (...args) { atHello ??= loaded.length; return write.apply(this, args); };",
    'process.on("exit", () => writeFileSync(process.env.READER_LOADS, JSON.stringify({ loaded, atHello })));',
  ].join("\n"));
  const status = ["status", "--dir", fx.dep, "--json"], workspace = ["workspace", "status", "--json", "--dir", fx.dep];
  // The CLI first: the remote cache the reads fill is then the same for the reader's run and the CLI's.
  for (const argv of [workspace, status]) assert.equal(fx.cli(argv).status, 0);
  const r = await helloed(fx, { ...fx.env, READER_LOADS: record }, { nodeArgs: ["--import", pathToFileURL(hook).href] });
  r.send({ id: 1, argv: status });
  const st = await r.next();
  r.send({ id: 2, argv: workspace });
  const ws = await r.next();
  assert.deepEqual(await r.end(), { code: 0, signal: null }, r.stderr);
  assert.match(JSON.stringify(st.answer.agents), /"dev-one"/, "status lists the instance");
  assertCliAnswer(fx, st, 1, status);
  assertCliAnswer(fx, ws, 2, workspace);
  assert.equal(ws.answer.ok, true, JSON.stringify(ws));
  const { loaded, atHello } = JSON.parse(readFileSync(record, "utf8"));
  assert.ok(atHello > 0, "the hello was written");
  const late = loaded.slice(atHello).filter((url) => url.startsWith(pathToFileURL(ROOT).href));
  assert.deepEqual(late, [], "no module of the install loads after the hello");
  for (const key of Object.keys(PRELOAD)) assert.ok(loaded.slice(0, atHello).some((url) => url.endsWith(`/lib/${key}.mjs`)), `lib/${key}.mjs loads before the hello`);
});

test("a line that is no request is E_READER_BAD_REQUEST: id null when the id is unreadable, the request's id when the argv is", { timeout: 60_000 }, async (t) => {
  const fx = v2Deployment({ t });
  const r = await helloed(fx, fx.env);
  const argv = ["status", "--dir", fx.dep, "--json"];
  const cases = [
    ["not json", null],
    ["{\"id\":1,\"argv\":", null],
    ["[1,2]", null],
    ["\"status\"", null],
    ["null", null],
    [{ id: "x".repeat(65), argv }, null],
    [{ id: 1.5, argv }, null],
    [{ id: 2 ** 53, argv }, null],
    [{ id: null, argv }, null],
    [{ id: true, argv }, null],
    [{ argv }, null],
    [{ id: "a", argv: "status --json" }, "a"],
    [{ id: 7, argv: ["status", 1] }, 7],
    [{ id: 8 }, 8],
  ];
  for (const [line, id] of cases) {
    r.send(line);
    assertRefused(await r.next(), id, "E_READER_BAD_REQUEST");
  }
  // A 64-character id is valid: counted in characters, not bytes.
  const long = "é".repeat(64);
  r.send({ id: long, argv: ["souls", "--json"] });
  assertRefused(await r.next(), long, "E_READER_UNSUPPORTED");
  assert.deepEqual(await r.end(), { code: 0, signal: null }, r.stderr);
});

test("an argv outside the accepted forms is E_READER_UNSUPPORTED, never an answer", { timeout: 60_000 }, async (t) => {
  const fx = v2Deployment({ t });
  const vanished = join(fx.base, "vanished");
  mkdirSync(vanished);
  rmSync(vanished, { recursive: true });
  const r = await helloed(fx, fx.env);
  const cases = [
    ["another read", ["souls", "--dir", fx.dep, "--json"]],
    ["a mutation", ["spawn", "dev", "--dir", fx.dep, "--json"]],
    ["help", ["status", "--help", "--dir", fx.dep, "--json"]],
    ["a relative --dir", ["status", "--dir", relative(process.cwd(), fx.dep), "--json"]],
    ["a relative --dir=", ["workspace", "status", "--dir=deployment", "--json"]],
    ["no --dir", ["status", "--json"]],
    ["no --json", ["status", "--dir", fx.dep]],
    ["a remote route", ["status", "--server", "x", "--json", "--dir", fx.dep]],
    ["a vanished --dir", ["status", "--dir", vanished, "--json"]],
    ["a vanished --dir (workspace status)", ["workspace", "status", "--dir", vanished, "--json"]],
    ["empty argv", []],
  ];
  for (const [what, argv] of cases) {
    r.send({ id: what, argv });
    assertRefused(await r.next(), what, "E_READER_UNSUPPORTED");
  }
  // The reader is kept: the next good request is answered.
  r.send({ id: "after", argv: ["status", "--dir", fx.dep, "--json"] });
  const after = await r.next();
  assert.equal(after.id, "after");
  assert.equal(after.exit, 0, JSON.stringify(after));
  assert.deepEqual(await r.end(), { code: 0, signal: null }, r.stderr);
});

test("--team and a bad --max-age get the CLI's own answers", { timeout: 120_000 }, async (t) => {
  const fx = v2Deployment({ t });
  const r = await helloed(fx, fx.env);
  const cases = [
    ["status", "--team", "--dir", fx.dep, "--json"],
    ["status", "--max-age", "abc", "--dir", fx.dep, "--json"],
    ["status", "--max-age=", "--dir", fx.dep, "--json"],
    ["workspace", "status", "--max-age", "abc", "--dir", fx.dep, "--json"],
    ["workspace", "status", "--max-age=", "--json", "--dir", fx.dep],
  ];
  for (const [i, argv] of cases.entries()) {
    r.send({ id: i, argv });
    const frame = await r.next();
    assertCliAnswer(fx, frame, i, argv);
    assert.notEqual(frame.exit, 0, JSON.stringify(frame));
    assert.equal(frame.answer.error.code, "E_BAD_ARGS", JSON.stringify(frame));
  }
  assert.deepEqual(await r.end(), { code: 0, signal: null }, r.stderr);
});

test("a line longer than 64 KiB is E_READER_BAD_REQUEST with id null, and the reader answers the next line", { timeout: 60_000 }, async (t) => {
  const fx = v2Deployment({ t });
  const r = await helloed(fx, fx.env);
  const argv = ["souls", "--json"]; // refused quickly: what is asserted is the line handling
  const sized = (id, bytes) => {
    const line = (pad) => JSON.stringify({ id, argv, pad });
    const s = line("x".repeat(bytes - line("").length));
    assert.equal(Buffer.byteLength(s), bytes);
    return s;
  };
  assert.equal(LINE_LIMIT, 64 * 1024);
  // Exactly the limit is a request; one byte more is not, whatever id it carries.
  r.send(sized("at-limit", LINE_LIMIT));
  assertRefused(await r.next(), "at-limit", "E_READER_UNSUPPORTED");
  r.send(sized("over", LINE_LIMIT + 1));
  assertRefused(await r.next(), null, "E_READER_BAD_REQUEST");
  // A much longer line, written in pieces, then a request in the same write as its end.
  r.child.stdin.write(sized("huge", 4 * LINE_LIMIT).slice(0, 3 * LINE_LIMIT));
  r.send(`${sized("huge", 4 * LINE_LIMIT).slice(3 * LINE_LIMIT)}`, { id: "next", argv: ["status", "--dir", fx.dep, "--json"] });
  assertRefused(await r.next(), null, "E_READER_BAD_REQUEST");
  const next = await r.next();
  assert.equal(next.id, "next");
  assert.equal(next.exit, 0, JSON.stringify(next));
  assert.deepEqual(await r.end(), { code: 0, signal: null }, r.stderr);
});

test("ids round-trip, strings and integers; unknown keys are tolerated; requests sent in one write are answered in order", { timeout: 120_000 }, async (t) => {
  const fx = v2Deployment({ t });
  const status = ["status", "--dir", fx.dep, "--json"], workspace = ["workspace", "status", "--dir", fx.dep, "--json"];
  for (const argv of [workspace, status]) assert.equal(fx.cli(argv).status, 0);
  const r = await helloed(fx, fx.env);
  const ids = ["req-1", 0, -42, Number.MAX_SAFE_INTEGER, "", "∂ unicode ✓", "9"];
  r.send(...ids.map((id, i) => ({ id, argv: i % 2 ? workspace : status, ...(i === 2 ? { client: { tick: 3 }, deadline: 5000, note: null } : {}) })));
  for (const [i, id] of ids.entries()) {
    const frame = await r.next();
    assert.strictEqual(frame.id, id, `answer ${i} is request ${i}'s`);
    assert.equal(frame.exit, 0, JSON.stringify(frame));
  }
  // The reader answers what the CLI does for a request with unknown keys.
  r.send({ id: "extra", argv: status, extra: true, argv2: ["x"] });
  assertCliAnswer(fx, await r.next(), "extra", status);
  assert.deepEqual(await r.end(), { code: 0, signal: null }, r.stderr);
});
