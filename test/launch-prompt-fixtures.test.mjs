import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { createLaunchPromptController } from "../lib/launch-prompts.mjs";
import { qualifyLaunchPromptFixtures } from "../lib/launch-prompt-fixtures.mjs";

const pin = "03d66745e3bb69ec727d66023696f3820bc0a00a8a5ba725eb6706d0c67cbe69";
const root = new URL("../lib/launch-prompt-fixtures/claude-2.1.289-darwin-arm64/", import.meta.url);
const captureHome = "/Users/juanre/Agents/oats/agents/oats-kernel-expert/instances/oats-kernel-expert-wake-lifecycle/work/708-fixtures/private-run/target";
const argv = ["--dangerously-load-development-channels", "plugin:aweb-channel@awebai-marketplace"];
const read = name => readFileSync(new URL(name, root), "utf8");
const negative = name => readFileSync(new URL(`./fixtures/launch-prompts/${name}`, import.meta.url), "utf8");
function executable(t) {
  const dir = mkdtempSync(join(tmpdir(), "oats-qualification-"));
  const path = join(dir, "claude");
  writeFileSync(path, "synthetic binary bytes, never executed", { mode: 0o755 });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path;
}
function args(executablePath, changes = {}) {
  return { home: captureHome, harness: "claude", executablePath, platform: "darwin", arch: "arm64", argv, ...changes };
}

test("reported version and executable name cannot substitute for pinned bytes", t => {
  const path = executable(t);
  assert.deepEqual(qualifyLaunchPromptFixtures(args(path)).fixtures, []);
  assert.deepEqual(qualifyLaunchPromptFixtures(args(path, { harness: { name: "claude", version: "2.1.289" } })).fixtures, []);
  assert.deepEqual(qualifyLaunchPromptFixtures(args("/nonexistent")).fixtures, []);
  assert.deepEqual(qualifyLaunchPromptFixtures(args(path, { harness: "other" })).fixtures, []);
});

test("accepted channel frame files retain exact digests and geometry", () => {
  const manifest = JSON.parse(read("manifest.json"));
  for (const name of ["frame-05-channel-seeded.txt", "frame-06-first-after-channel.txt", "frame-07-after-channel-200ms.txt"]) {
    const text = read(name);
    assert.equal(crypto.createHash("sha256").update(text).digest("hex"), manifest.frames[name].sha256);
    assert.equal(Buffer.byteLength(text), manifest.frames[name].bytes);
    assert.equal(text.split("\n").length - 1, 35);
  }
});

test("qualified fixture construction and argv exclusions (synthetic hash substitution only)", t => {
  const path = executable(t);
  // Test-local substitution exercises adapter structure without invoking a real
  // harness or requiring its proprietary binary in CI. Production has no hash
  // override seam; the preceding test verifies actual mismatched bytes fail.
  const original = crypto.createHash;
  const fakeDigest = original("sha256").update(readFileSync(path)).digest("hex");
  const mock = t.mock.method(crypto, "createHash", (...params) => {
    const hash = original(...params);
    const finish = hash.digest.bind(hash);
    hash.digest = encoding => {
      const value = finish(encoding);
      return value === fakeDigest ? pin : value;
    };
    return hash;
  });
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  const qualified = qualifyLaunchPromptFixtures(args(path));
  assert.equal(qualified.harness.version, "2.1.289");
  assert.equal(qualified.harness.developmentChannelEligible, true);
  assert.equal(qualified.fixtures.length, 1);
  const channel = qualified.fixtures[0].frames[0];
  assert.deepEqual(channel.after, []);
  assert.equal("sequence" in channel, false);
  assert.equal(qualified.fixtures[0].frames.at(-1).kind, "completed");
  const otherHome = qualifyLaunchPromptFixtures(args(path, { home: "/some/other/home" }));
  assert.equal(otherHome.fixtures.length, 1);
  assert.ok(otherHome.fixtures.every(f => f.frames.every(frame => frame.class !== "workspaceTrust")));
  for (const badArgv of [[], ["--channels", argv[1]], [...argv, "plugin:other"], [...argv, "--channels", argv[1]], [...argv, ...argv], [`${argv[0]}=${argv[1]}`], [argv[0], "plugin:other"], [argv[0], argv[1] + ",plugin:other"]]) {
    const result = qualifyLaunchPromptFixtures(args(path, { argv: badArgv }));
    assert.equal(result.harness.developmentChannelEligible, false, JSON.stringify(badArgv));
    assert.equal(result.fixtures.length, 0);
  }
  for (const change of [{ platform: "linux" }, { arch: "x64" }, { harness: "other" }]) assert.deepEqual(qualifyLaunchPromptFixtures(args(path, change)).fixtures, []);
  // Completion variations are exact home-derived lines only. None is input
  // authority, and the known surrounding frame cannot be weakened.
  const normalHome = join(homedir(), "oats", "project");
  const normal = qualifyLaunchPromptFixtures(args(path, { home: normalHome }));
  const completions = normal.fixtures.flatMap(f => f.frames).filter(f => f.kind === "completed");
  const lines = new Set(completions.map(f => f.text.split("\n")[2]));
  assert.ok(lines.has(" ▝▝   ▝▝   ~/oats/project"));
  assert.ok(lines.has(" ▝▝   ▝▝   ~/…/project"));
  assert.ok(!lines.has(" ▝▝   ▝▝   ~/…/roject"));
  assert.ok(!lines.has(" ▝▝   ▝▝   ~/…/foreign"));
  assert.ok([...lines].every(line => line.length <= 110));
  for (const home of ["/bad//home", "/bad/../home", "/bad/./home", "/bad/é", "/bad/\nhome", homedir() + "-other/project"]) {
    const frames = qualifyLaunchPromptFixtures(args(path, { home })).fixtures.flatMap(f => f.frames).filter(f => f.kind === "completed");
    if (home.endsWith("-other/project")) assert.ok(frames.every(f => !f.text.split("\n")[2].includes("~")));
    else assert.equal(frames.length, 0);
  }
  const sequence = qualifyLaunchPromptFixtures(args(path, { home: captureHome + "-sequence" }));
  assert.ok(sequence.fixtures.flatMap(f => f.frames).every(f => f.class === undefined || f.class === "awebDevelopmentChannel"));
  assert.ok(sequence.fixtures.flatMap(f => f.frames).every(f => f.after.length <= 1));
  assert.equal(negative("seq-06-session-after-channel.txt").split("\n").filter((_, i) => i !== 2).join("\n"), read("frame-07-after-channel-200ms.txt").split("\n").filter((_, i) => i !== 2).join("\n"));

  // Replay the actual accepted channel bytes at an existing canonical home.
  const home = realpathSync(dirname(path));
  const ready = qualifyLaunchPromptFixtures(args(path, { home }));
  const frames = ready.fixtures.flatMap(f => f.frames);
  const prompt = frames.find(f => f.kind === "prompt").text;
  const complete = frames.find(f => f.kind === "completed" && f.after.join() === "awebDevelopmentChannel").text;
  const target = { socket: "/private/test", windowId: "@1", paneId: "%1", pid: "123" };
  for (const mode of ["valid", "foreign", "partial", "footer", "question", "installed", "model", "billing", "effort", "send-failed", "audit-failed"]) {
    let text = prompt, sends = 0;
    const controller = createLaunchPromptController({ home, startId: "fixture-test", ...ready, geometry: undefined,
      policy: { awebDevelopmentChannel: true }, audit: () => ({ ok: mode !== "audit-failed" }),
      transport: {
        snapshot: () => ({ ...target, width: 110, height: 35, text }),
        send: () => {
          sends++;
          text = complete;
          if (mode === "foreign") text = text.replace(home, "/foreign/home");
          if (mode === "partial") text = text.replace(home, home.slice(1));
          if (mode === "footer") text += "unexpected footer";
          if (mode === "question") text = text.replace("plugin not installed", "Allow this plugin?");
          if (mode === "installed") text = text.replace("plugin not installed", "plugin connected");
          if (mode === "model") text = text.replace("Opus 5.5", "Sonnet 5");
          if (mode === "billing") text = text.replace("API Usage Billing", "Pro Subscription");
          if (mode === "effort") text = text.replace("medium · /effort", "high · /effort");
          return { status: mode === "send-failed" ? "failed" : "submitted" };
        },
      },
    });
    const observed = controller.observeNew(target);
    assert.equal(observed.status, mode === "valid" ? "completed" : ["audit-failed", "send-failed"].includes(mode) ? "incomplete" : "blocked", mode);
    if (["installed", "model", "billing", "effort"].includes(mode)) {
      assert.equal(observed.answers.length, 1, "the submitted answer survives the later blocked frame");
      assert.equal(observed.answers[0].status, "submitted");
      assert.equal(sends, 1);
    }
    const previousSends = sends;
    text = prompt;
    assert.equal(controller.observeNew(target), observed);
    assert.equal(sends, previousSends, "completion and errors close authority permanently");
  }
  // Captured folder-trust screens have no production matcher, regardless of
  // selection. Each is blocked with a receipt and absolutely no input.
  for (const name of ["frame-01.txt", "frame-02-trust-selected.txt", "seq-02-trust-resized-110x35.txt", "seq-03-trust-confirm-selected.txt"]) {
    const events = [], keys = [];
    const controller = createLaunchPromptController({ home, startId: "negative-trust", ...ready, geometry: undefined,
      policy: { awebDevelopmentChannel: true },
      audit(data) { events.push(data); return { ok: true, row: { kind: "launch-prompt", data }, results: [{ path: "/actual/log", ok: true }] }; },
      transport: { snapshot: () => ({ ...target, width: 110, height: 35, text: negative(name) }), send: (_, key) => { keys.push(key); return { status: "submitted" }; } },
    });
    const result = controller.observeNew(target);
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "blocked: unexpected prompt");
    assert.equal(result.receipt[0].row.data.startId, "negative-trust");
    assert.equal(events.at(-1).status, "blocked");
    assert.deepEqual(keys, []);
  }
  assert.equal(ready.validateExecutable(), true);
  chmodSync(path, 0o644);
  assert.equal(ready.validateExecutable(), false);
  assert.deepEqual(qualifyLaunchPromptFixtures(args(path)).fixtures, []);
});
