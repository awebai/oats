// Source fixtures for a finite private entry; no setup or real manager calls.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureDefaultRootPlan } from "../lib/capture-default-roots.mjs";
import { captureServiceRequest, captureServiceDefinition } from "../lib/capture-service-definition.mjs";
import { readCaptureStatus } from "../lib/capture-status.mjs";
import { acquireCaptureLock, captureLockPath } from "../lib/capture-lock.mjs";
import { RecordStore } from "../lib/store.mjs";

const entry = fileURLToPath(new URL("../lib/capture-service-runner.mjs", import.meta.url));
const worker = fileURLToPath(new URL("../lib/capture-command-worker.mjs", import.meta.url));
function fixture(t) {
  const base = fs.mkdtempSync(join(tmpdir(), "capture-service-entry-")), home = join(base, "home"), root = join(base, "record");
  const cc = join(base, "native/projects/project/session.jsonl"), aw = join(home, ".config/aw/logs/account.jsonl");
  for (const directory of [join(base, "native/projects/project"), join(home, ".config/aw/logs"), join(base, "cache")]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(cc, JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", text: "service native" }) + "\n");
  fs.writeFileSync(aw, JSON.stringify({ ts: "2026-01-01T00:00:00Z", ch: "mail", dir: "recv", from: "peer", body: "service AW" }) + "\n");
  const plan = captureDefaultRootPlan({ home, cwd: base, env: { CLAUDE_CONFIG_DIR: "native" } });
  const request = { root: "record", owner: "fixture", plan };
  const launch = join(base, "launch.json"), guard = join(base, "guard.mjs");
  fs.writeFileSync(guard, `import cp from 'node:child_process'; import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
cp.execFileSync = cp.spawnSync = () => { throw new Error('service attempted a manager or synchronous child'); };
const spawn = cp.spawn;
cp.spawn = (exe, args, options) => {
  if (exe !== process.execPath || args.at(-1) !== ${JSON.stringify(worker)}) throw new Error('service child is not fixed worker');
  fs.writeFileSync(${JSON.stringify(launch)}, JSON.stringify({ exe, args, env: options.env }));
  return spawn(exe, args, options);
}; syncBuiltinESMExports();`);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, home, root, cc, request, launch,
    run(value = request, extraArgs = []) {
      return spawnSync(process.execPath, ["--no-warnings", "--import", guard, entry, JSON.stringify(value), ...extraArgs], {
        // Ambient selectors deliberately differ: the persisted explicit plan wins.
        cwd: home, env: { HOME: home, PATH: process.env.PATH, TMPDIR: base, XDG_CACHE_HOME: join(base, "cache"),
          TURN_RECORD_ROOT: join(base, "wrong-root"), CLAUDE_CONFIG_DIR: join(base, "wrong-native") },
        encoding: "utf8", timeout: 30000,
      });
    },
  };
}

test("finite service entry uses explicit selection and worker service receipts, then dedupes", t => {
  const f = fixture(t), result = f.run(); assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /capture: 2 new turns; complete/); assert.match(result.stdout, /index: updated/);
  const status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.trigger, "service"); assert.equal(status.lastRun.outcome, "complete");
  assert.ok(status.lastRun.finishedAt); assert.notEqual(status.lastRun.pid, result.pid);
  assert.equal(status.lastSuccess.id, status.lastRun.id); assert.equal(status.backlog.pending, false);
  assert.equal(status.lastRun.counts.turnsAppended, 2); assert.equal(status.lastRun.counts.turnsIndexed, 2);
  const launched = JSON.parse(fs.readFileSync(f.launch));
  assert.equal(launched.exe, process.execPath); assert.ok(launched.args.includes("--max-old-space-size=256"));
  assert.equal(launched.args.at(-1), worker); assert.equal(launched.env.NODE_OPTIONS, undefined);
  const store = new RecordStore(f.root, { owner: "fixture" });
  assert.equal(store.readStream("fixture~cc.session").length, 1); assert.equal(store.readStream("fixture~aw").length, 1);
  assert.equal(fs.existsSync(join(f.base, "wrong-root")), false); assert.equal(fs.existsSync(captureLockPath(f.root)), false);
  const again = f.run(); assert.equal(again.status, 0, again.stderr); assert.match(again.stdout, /0 new turns; complete/);
  assert.equal(readCaptureStatus(f.root).lastRun.counts.turnsIndexed, 0);
});

test("service partial and overlap preserve truthful pending/history without inventing completion", t => {
  const f = fixture(t); fs.appendFileSync(f.cc, '{"text":"private unfinished');
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /capture: 2 new turns; partial \(input\)/); assert.match(result.stdout, /index: pending/);
  assert.doesNotMatch(result.stdout + result.stderr, /private unfinished|index: updated/);
  const status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.trigger, "service"); assert.equal(status.lastRun.outcome, "partial");
  assert.equal(status.lastRun.counts.inputsPending, 1); assert.equal(status.backlog.pending, true); assert.equal(status.lastSuccess, null);
  const before = fs.readFileSync(join(f.root, "capture-status.json")), lock = acquireCaptureLock(f.root);
  try {
    const overlap = f.run(); assert.equal(overlap.status, 0, overlap.stderr);
    assert.match(overlap.stdout, /another pass holds .*skipping this pass/); assert.doesNotMatch(overlap.stdout, /new turns/);
    assert.deepEqual(fs.readFileSync(join(f.root, "capture-status.json")), before);
  } finally { lock.release(); }
});

test("service rejects request/policy injection and privacy failure before worker/lock creation", t => {
  const f = fixture(t);
  for (const value of [null, [], { ...f.request, root: "" }, { ...f.request, owner: "bad/owner" },
    ...["workerPath", "node", "trigger", "indexEnabled", "retrySetAside", "policy"].map(key => ({ ...f.request, [key]: "override" })),
    { ...f.request, plan: { ...f.request.plan, sources: ["aw"] } }]) {
    const result = f.run(value); assert.equal(result.status, 1, result.stderr);
    assert.equal(fs.existsSync(f.root), false); assert.equal(fs.existsSync(f.launch), false);
  }
  assert.equal(f.run(f.request, ["extra"]).status, 1); assert.equal(fs.existsSync(f.root), false);
  fs.mkdirSync(join(f.root, "ignore"), { recursive: true });
  const refused = f.run(); assert.equal(refused.status, 1); assert.match(refused.stderr, /cannot read capture ignore file/);
  assert.equal(fs.existsSync(f.launch), false); assert.equal(fs.existsSync(captureLockPath(f.root)), false);
  assert.equal(fs.existsSync(join(f.root, "capture-status.json")), false);
});

test("service operational discovery failure commits independent work and reports failure, never zero success", t => {
  const f = fixture(t), bad = join(f.base, "not-directory"); fs.writeFileSync(bad, "refused");
  const result = f.run({ ...f.request, plan: { ...f.request.plan, env: { CLAUDE_CONFIG_DIR: bad } } });
  assert.equal(result.status, 1, result.stdout); assert.match(result.stderr, /capture service failed: capture worker failed/);
  assert.doesNotMatch(result.stdout, /new turns|index: updated/);
  const status = readCaptureStatus(f.root); assert.equal(status.lastRun.trigger, "service");
  assert.equal(status.lastRun.outcome, "failed"); assert.equal(status.lastRun.reason, "io");
  assert.equal(status.lastFailure.id, status.lastRun.id); assert.equal(status.lastSuccess, null);
  assert.equal(status.lastRun.counts.turnsAppended, 1); assert.equal(status.lastRun.counts.turnsIndexed, 1);
  assert.equal(status.backlog.pending, true); assert.equal(fs.existsSync(captureLockPath(f.root)), false);
});

// Read the exact emitted quoted-word subset. Refuse lone expansion syntax;
// this is an argument-boundary oracle, not qualification of a real manager.
function systemdArgs(text) {
  const words = []; let i = 0;
  while (i < text.length) {
    assert.equal(text[i++], '"'); let word = "";
    while (text[i] !== '"') {
      assert.ok(i < text.length, "closed word");
      if (text[i] === "\\") { i++; assert.ok(['"', "\\"].includes(text[i])); }
      word += text[i++];
    }
    i++; if (i < text.length) assert.equal(text[i++], " ");
    assert.doesNotMatch(word.replace(/%%/g, ""), /%/);
    if (words.length) { assert.doesNotMatch(word.replace(/\$\$/g, ""), /\$/); word = word.replace(/\$\$/g, "$"); }
    words.push(word.replace(/%%/g, "%"));
  }
  return words;
}

test("pure periodic definitions preserve argv and literal manager expansion syntax without writing targets", t => {
  const f = fixture(t), plan = captureDefaultRootPlan({ home: join(f.base, 'home & <tag> "quote"'), cwd: f.base,
    env: { CLAUDE_CONFIG_DIR: 'space tab\tquote" slash\\ ${HOME} $WORD %h', PI_CODING_AGENT_DIR: "line\nbreak", CODEX_HOME: "unicode-雪" } });
  const request = { owner: "fixture", root: 'store space "quote" \\ $HOME %h', plan };
  for (const platform of ["darwin", "linux"]) {
    const node = join(f.base, "node space $literal %h");
    const result = captureServiceDefinition({ platform, node, request });
    assert.deepEqual(result.argv, [node, entry, JSON.stringify(captureServiceRequest(request))]);
    for (const file of result.files) { assert.equal(fs.existsSync(file.path), false); assert.match(file.contents, /oats-turn-record-service:1/); }
    if (platform === "darwin") {
      const plist = result.files[0].contents, array = /<array>(.*?)<\/array>/s.exec(plist)[1];
      const words = [...array.matchAll(/<string>(.*?)<\/string>/gs)].map(([, value]) => value.replace(/&#13;/g, "\r").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
      assert.deepEqual(words, result.argv); assert.match(plist, /<key>StartInterval<\/key><integer>900<\/integer>/);
      assert.match(plist, /<key>RunAtLoad<\/key><true\/>/); assert.doesNotMatch(plist, /KeepAlive|--watch/);
      assert.equal(result.files[0].path, join(plan.home, "Library/LaunchAgents/ai.aweb.turn-record-capture.plist"));
    } else {
      const [service, timer] = result.files.map(file => file.contents);
      assert.deepEqual(systemdArgs(/^ExecStart=(.*)$/m.exec(service)[1]), result.argv);
      assert.match(service, /^Type=exec$/m); assert.match(service, /^MemoryMax=2G$/m); assert.match(service, /^RuntimeMaxSec=300$/m);
      assert.doesNotMatch(service, /Restart|--watch|WantedBy/);
      assert.match(timer, /^OnBootSec=1min$/m); assert.match(timer, /^OnUnitActiveSec=15min$/m);
      assert.match(timer, /^Unit=turn-record-capture.service$/m); assert.match(timer, /^WantedBy=timers.target$/m);
      assert.equal(result.files.length, 2);
    }
  }
  assert.equal(fs.existsSync(plan.home), false); assert.equal(fs.existsSync(f.root), false);
});

test("definition rendering rejects unsupported manager/executable encodings without filesystem work", t => {
  const f = fixture(t);
  for (const node of ["node", "/node\nnewline", "/node\0nul", "/node\ud800"]) for (const platform of ["linux", "darwin"])
    assert.throws(() => captureServiceDefinition({ platform, node, request: f.request }), /invalid/);
  for (const node of ["/node'quote", '/node"quote', "/node\\slash"])
    assert.throws(() => captureServiceDefinition({ platform: "linux", node, request: f.request }), /unrepresentable/);
  assert.throws(() => captureServiceDefinition({ platform: "darwin", node: "/node\uffff", request: f.request }), /unrepresentable/);
  assert.throws(() => captureServiceDefinition({ platform: "other", node: process.execPath, request: f.request }), /invalid/);
  assert.equal(fs.existsSync(f.root), false); assert.equal(fs.existsSync(f.launch), false);
});

test("definitions copy the caller plan and XML retains log-path carriage returns", t => {
  const f = fixture(t), request = { ...f.request, plan: { ...f.request.plan, home: join(f.base, "home\rname") } };
  const definition = captureServiceDefinition({ platform: "darwin", node: process.execPath, request });
  assert.match(definition.files[0].contents, /home&#13;name/);
  const saved = JSON.parse(definition.argv[2]);
  request.plan.env.CLAUDE_CONFIG_DIR = "later-selection";
  request.plan.sources.pop();
  assert.equal(saved.plan.env.CLAUDE_CONFIG_DIR, "native"); assert.equal(saved.plan.sources.length, 4);
  assert.equal(saved.plan.home, join(f.base, "home\rname")); assert.equal(saved.root, f.root);
  assert.equal(fs.existsSync(saved.plan.home), false);
});
