// 0.31 session defaults: oats-local.yaml `session.tmuxSession` and the tmux session a NEW launch opens
// in, liveness that reads each home's RECORDED tmux session, and a keep-dir self-retire of a pre-0.31
// home.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { listInstances, retireInstance, sessionDefaults } from "../lib/core.mjs";
import { validateLocal } from "../lib/workspace.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-session-backend-")));
test.after(() => rmSync(base, { recursive: true, force: true }));

/** A fake tmux on PATH: sessions → window names; every call is logged. */
function fakeTmux(dir, sessions) {
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "tmux-calls.log");
  writeFileSync(log, "");
  const cases = Object.entries(sessions).map(([name, windows]) => `    ${name}) printf '%s\\n' ${windows.map((w) => `'${w}'`).join(" ")};;`).join("\n");
  writeFileSync(join(dir, "tmux"), `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
target=""; prev=""
for a in "$@"; do [ "$prev" = "-t" ] && target="$a"; prev="$a"; done
case "$1" in
  has-session) case "$target" in ${Object.keys(sessions).join("|") || "__none__"}) exit 0;; *) exit 1;; esac;;
  list-windows) case "$target" in
${cases}
    *) exit 1;; esac;;
esac
exit 0
`);
  chmodSync(join(dir, "tmux"), 0o755);
  return log;
}

function deployment(name, session) {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  const lines = ["schemaVersion: 2", "workspace: git:github.com/example/ws"];
  if (session) lines.push("session:", ...Object.entries(session).map(([k, v]) => `  ${k}: ${v}`));
  writeFileSync(join(dir, "oats-local.yaml"), lines.join("\n") + "\n");
  return dir;
}

test("the tmux session: session.tmuxSession, then OATS_TMUX_SESSION, then PI_AGENTS_TMUX_SESSION (still honoured), then oats-agents", async () => {
  const none = deployment("tmux-none");
  const local = deployment("tmux-local", { tmuxSession: "from-local" });
  assert.equal(sessionDefaults(none, {}, {}).tmuxSession, "oats-agents");
  assert.equal(sessionDefaults(none, {}, { PI_AGENTS_TMUX_SESSION: "legacy" }).tmuxSession, "legacy");
  assert.equal(sessionDefaults(none, {}, { OATS_TMUX_SESSION: "new", PI_AGENTS_TMUX_SESSION: "legacy" }).tmuxSession, "new");
  assert.equal(sessionDefaults(local, {}, { OATS_TMUX_SESSION: "new", PI_AGENTS_TMUX_SESSION: "legacy" }).tmuxSession, "from-local");
  // DEFAULT_TMUX_SESSION (status, retire and the Desktop's fallback) is fixed at load: read it in a
  // child whose environment holds only what each case sets.
  const { execFileSync } = await import("node:child_process");
  const core = new URL("../lib/core.mjs", import.meta.url).href;
  const load = (env) => execFileSync(process.execPath, ["--input-type=module", "-e", `import(${JSON.stringify(core)}).then((m) => process.stdout.write(m.DEFAULT_TMUX_SESSION))`], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, encoding: "utf8" });
  assert.equal(load({}), "oats-agents");
  assert.equal(load({ PI_AGENTS_TMUX_SESSION: "legacy" }), "legacy");
  assert.equal(load({ OATS_TMUX_SESSION: "new", PI_AGENTS_TMUX_SESSION: "legacy" }), "new");
});

test("oats-local.yaml session is validated: a tmux-safe tmuxSession and no other keys (the session block holds no backend)", () => {
  const doc = (session) => ({ schemaVersion: 2, workspace: "git:github.com/example/ws", session });
  assert.deepEqual(validateLocal(doc({ tmuxSession: "pi-agents" })), []);
  assert.deepEqual(validateLocal(doc({})), []);
  for (const bad of [{ backend: "herdr" }, { tmuxSession: "has space" }, { tmuxSession: "a:b" }, { tmuxSession: "" }, { socket: "/x" }]) {
    assert.ok(validateLocal(doc(bad)).length > 0, JSON.stringify(bad));
  }
});

test("a new tmux spawn opens in session.tmuxSession", async () => {
  const chosen = v2Deployment({ local: { session: { tmuxSession: "team-x" } } });
  try {
    const a = await chosen.spawn("dev", { name: "chosen-1" });
    assert.equal(a.tmux?.session, "team-x");
    assert.equal(a.backendFrom, undefined, "no backendFrom: the backend is only ever --backend");
  } finally { chosen.cleanup(); }
});

test("status reads each tmux home in the session it recorded: a pre-0.31 pi-agents home still shows running", async () => {
  const fx = v2Deployment();
  const log = fakeTmux(join(base, "fake-tmux-status"), { "pi-agents": ["old-1"], "oats-agents": ["new-1"] });
  const path = process.env.PATH;
  try {
    process.env.PATH = fx.env.PATH;
    for (const [name, session] of [["old-1", "pi-agents"], ["new-1", "oats-agents"], ["gone-1", "pi-agents"]]) {
      const spawned = await fx.spawn("dev", { name, backend: "tmux" });
      const metaPath = join(spawned.home, "instance.json");
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      writeFileSync(metaPath, JSON.stringify({ ...meta, tmux: { session, window: name } }, null, 2) + "\n");
    }
    process.env.PATH = `${join(base, "fake-tmux-status")}:${fx.env.PATH}`;
    const rows = listInstances(fx.root, "oats-agents").flatMap((a) => a.instances).filter((i) => /-1$/.test(i.instance));
    assert.deepEqual(rows.map((r) => [r.instance, r.running]).sort(), [["gone-1", false], ["new-1", true], ["old-1", true]]);
    const listed = readFileSync(log, "utf8").split("\n").filter((l) => l.startsWith("list-windows"));
    assert.equal(listed.length, 2, "each recorded session is listed once");
  } finally { process.env.PATH = path; fx.cleanup(); }
});

test("a self-retire that keeps its directory kills the window the home recorded, not one in the new default session", async () => {
  const fx = v2Deployment();
  const log = fakeTmux(join(base, "fake-tmux-retire"), {});
  const path = process.env.PATH, inst = process.env.OATS_INSTANCE;
  try {
    process.env.PATH = fx.env.PATH;
    const spawned = await fx.spawn("dev", { name: "keep-1", backend: "tmux" });
    const metaPath = join(spawned.home, "instance.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    writeFileSync(metaPath, JSON.stringify({ ...meta, tmux: { session: "pi-agents", window: "keep-1" } }, null, 2) + "\n");
    process.env.PATH = `${join(base, "fake-tmux-retire")}:${fx.env.PATH}`;
    process.env.OATS_INSTANCE = "keep-1";
    const r = retireInstance(fx.root, "keep-1", { self: true, keepDir: true, selfKillDelaySec: 600 });
    assert.equal(r.selfKillScheduled, true);
    const kill = readFileSync(log, "utf8").split("\n").find((l) => l.startsWith("run-shell"));
    assert.ok(kill && kill.includes("=pi-agents:=keep-1"), `the scheduled kill targets the recorded window: ${kill}`);
  } finally {
    process.env.PATH = path;
    if (inst === undefined) delete process.env.OATS_INSTANCE; else process.env.OATS_INSTANCE = inst;
    fx.cleanup();
  }
});

test("a self-retire that keeps its directory schedules the kill on the socket the home recorded: the scheduling and the kill both name it", async () => {
  const fx = v2Deployment();
  const log = fakeTmux(join(base, "fake-tmux-retire-socket"), {});
  const path = process.env.PATH, inst = process.env.OATS_INSTANCE;
  // A path a shell would split or expand, and a # that run-shell would read as a format.
  const socket = join(base, "it's a dir", "oats#1");
  const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  try {
    process.env.PATH = fx.env.PATH;
    const spawned = await fx.spawn("dev", { name: "keep-2", backend: "tmux" });
    const recorded = { session: "oats-agents", window: "keep-2", socket };
    const metaPath = join(spawned.home, "instance.json");
    writeFileSync(metaPath, JSON.stringify({ ...JSON.parse(readFileSync(metaPath, "utf8")), launched: true, tmux: recorded }, null, 2) + "\n");
    const receiptPath = join(dirname(spawned.home), ".oats-retirement", "baselines", `${createHash("sha256").update(spawned.home).digest("hex")}.json`);
    writeFileSync(receiptPath, JSON.stringify({ ...JSON.parse(readFileSync(receiptPath, "utf8")), runtime: { launched: true, tmux: recorded } }, null, 2) + "\n", { mode: 0o600 });
    process.env.PATH = `${join(base, "fake-tmux-retire-socket")}:${fx.env.PATH}`;
    process.env.OATS_INSTANCE = "keep-2";
    const r = retireInstance(fx.root, "keep-2", { self: true, keepDir: true, selfKillDelaySec: 600 });
    assert.equal(r.selfKillScheduled, true);
    const kill = readFileSync(log, "utf8").split("\n").find((l) => l.includes("run-shell"));
    const inner = `sleep 600; tmux -u -S ${shq(socket)} kill-window -t '=oats-agents:=keep-2' 2>/dev/null || true`.replace(/#/g, "##");
    assert.equal(kill, `-u -S ${socket} run-shell -b ${inner}`, "run-shell is sent to the recorded socket, and the command it runs names that socket too");
  } finally {
    process.env.PATH = path;
    if (inst === undefined) delete process.env.OATS_INSTANCE; else process.env.OATS_INSTANCE = inst;
    fx.cleanup();
  }
});

test("oats inspect shows the tmux session a new spawn here would open in", () => {
  const fx = v2Deployment({ local: { session: { tmuxSession: "team-x" } } });
  try {
    const r = fx.cli(["inspect", "--soul", "dev", "--json"], { env: { OATS_TMUX_SESSION: "", PI_AGENTS_TMUX_SESSION: "" } });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.json().result.session, { tmuxSession: "team-x" });
  } finally { fx.cleanup(); }
});
