// Packaged-app probe runners for dist-smoke — extracted so the execution
// discipline is CONTRACT-TESTED (review ac366f9: reverting the smoke to
// synchronous execution previously left every reaper test green).
//
// Contract: every probe of the packaged app runs through the injected
// reaper's runTracked — asynchronous, detached, group-tracked, settled on
// close. There is NO synchronous execution primitive in this module, and
// the tests import it to assert the probe call goes through runTracked.
import { mkdtempSync, rmSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serverSpawnSpec } from "../server-host.mjs";
import { boundedTail } from "./launch-probe.mjs";

/**
 * How the packaged executable is run as Node. macos-14 runners are arm64:
 * for the x64 cross-build the packaged x64 Electron is invoked explicitly
 * through Rosetta — auto-translation is not a sufficient CI contract and may
 * not engage predictably. Executing the REAL x64 app catches a wrong-arch
 * native module. The caller adds ELECTRON_RUN_AS_NODE=1 to the environment.
 */
export function packagedNode(appExe, args, { targetArch, platform = process.platform, hostArch = process.arch } = {}) {
  const rosetta = platform === "darwin" && hostArch === "arm64" && targetArch === "x64";
  return rosetta
    ? { exe: "/usr/bin/arch", args: ["-x86_64", appExe, ...args], rosetta }
    : { exe: appExe, args, rosetta };
}

export function abiProbeSource(asarMainPath) {
  return `
    const { createRequire } = require("node:module");
    const req = createRequire(${JSON.stringify(asarMainPath)});
    const pty = req("node-pty");
    const p = pty.spawn("/bin/sh", ["-c", "echo pty-alive"], { cols: 20, rows: 5, cwd: "/tmp" });
    let out = "";
    p.onData((d) => { out += d; });
    p.onExit(() => { console.log(out.includes("pty-alive") ? "PTY_OK" : "PTY_NO_OUTPUT"); process.exit(0); });
    setTimeout(() => { console.log("PTY_TIMEOUT"); process.exit(1); }, 8000);
  `;
}

/**
 * Run the node-pty ABI probe against the packaged app.
 * `reaper` MUST provide runTracked (the group-tracked async runner); this
 * function never falls back to synchronous execution.
 * Returns { ok, detail }.
 */
export async function runAbiProbe(reaper, appExe, asarMainPath, {
  timeout = 30000, env = process.env, targetArch,
  platform = process.platform, hostArch = process.arch,
} = {}) {
  if (typeof reaper?.runTracked !== "function") {
    return { ok: false, detail: "probe runner requires a reaper with runTracked (async group-tracked execution is the contract)" };
  }
  // Through Rosetta on the macOS x64 cross-build (packagedNode).
  const { exe, args, rosetta } = packagedNode(appExe, ["-e", abiProbeSource(asarMainPath)], { targetArch, platform, hostArch });
  const r = await reaper.runTracked(exe, args, {
    timeout,
    env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
  });
  const mode = rosetta ? " under Rosetta x86_64" : "";
  if (r.timedOut) return { ok: false, detail: `node-pty ABI probe${mode} timed out (group killed)` };
  if (!r.stdout.includes("PTY_OK")) {
    const combined = `${String(r.stdout)}\n${String(r.stderr || "")}`.trim().slice(-500);
    return { ok: false, detail: `node-pty ABI probe${mode} failed (exit ${r.code}): ${combined}` };
  }
  return { ok: true, detail: `node-pty loads and spawns under the packaged Electron ABI${mode} (via app.asar)` };
}

/** As the hermetic tests start the backend: no oats CLI is discoverable, no login shell runs. */
export const NO_CLI_ENV = Object.freeze({ OATS_DESKTOP_OATS_BIN: "", PATH: "/nonexistent", SHELL: "/bin/false" });

async function freePort() {
  const s = createServer();
  await new Promise((ok, bad) => { s.once("error", bad); s.listen(0, "127.0.0.1", ok); });
  const { port } = s.address();
  await new Promise((ok) => s.close(ok));
  return port;
}

/** Whether something accepts a connection on the loopback port. */
function portOpen(port) {
  return new Promise((done) => {
    const c = createConnection({ host: "127.0.0.1", port });
    const end = (open) => { c.destroy(); done(open); };
    c.once("connect", () => end(true));
    c.once("error", () => end(false));
    c.setTimeout(2000, () => end(false));
  });
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
/** `promise`'s value, or null after `ms`; the timer never outlives the wait. */
async function within(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((ok) => { timer = setTimeout(() => ok(null), ms); })]); }
  finally { clearTimeout(timer); }
}
const seconds = (ms) => `${Math.round(ms / 100) / 10}s`;

/**
 * The headless backend phase: what the packaged app runs as Node, run
 * without a display (#634).
 *  1. the backend (`bin`, app.asar/server/oats-web.mjs) is started THROUGH
 *     THE PRODUCTION SPEC (`serverSpawnSpec`, as main starts it) with the
 *     packaged executable as execPath, no deployment, a free port, a
 *     temporary home and no CLI discoverable, and must answer GET /api/cli
 *     (any HTTP answer) within `readyMs`;
 *  2. its stdin is then closed, as the kernel closes it when main ends, and
 *     it must exit 0 with its port closed within `exitMs` (#698's lifeline);
 *  3. the collector (`collector`, app.asar/server/liveness-main.mjs, the
 *     entry the backend starts) is run as Node with `[]` on stdin and must
 *     print `[]` within `collectorMs`.
 * Every process goes through the reaper (spawnTracked/runTracked: detached,
 * group-tracked) and is reaped, and the backend awaited, before this returns,
 * on every path. `spec` is injectable so a test can start a server without
 * the lifeline. Returns { ok, detail, lines, pids }: on success `lines` are
 * the phase's evidence, what was proven and what was not.
 */
export async function runBackendProbe(reaper, appExe, {
  bin, collector, env = process.env, spec = serverSpawnSpec,
  readyMs = 90_000, exitMs = 15_000, collectorMs = 60_000,
  targetArch, platform = process.platform, hostArch = process.arch,
} = {}) {
  const pids = {};
  if (typeof reaper?.spawnTracked !== "function" || typeof reaper?.runTracked !== "function" || typeof reaper?.reapGroup !== "function") {
    return { ok: false, detail: "backend probe requires a reaper with spawnTracked, runTracked and reapGroup (async group-tracked execution is the contract)", pids };
  }
  const how = { targetArch, platform, hostArch };
  const mode = packagedNode(appExe, [], how).rosetta ? " under Rosetta x86_64" : "";
  const home = mkdtempSync(join(tmpdir(), "oats-smoke-backend-"));
  let child = null, exited = null, tail = "";
  let settle;
  const exit = new Promise((ok) => { settle = ok; });
  const fail = (detail) => ({ ok: false, detail, pids });
  const output = () => tail.trim().slice(-1500) || "(no output)";
  try {
    const port = await freePort();
    const s = spec({ execPath: appExe, bin, dirs: [], port, oatsBin: null, pathSource: "inherited", pathError: null,
      remoteIdentityFile: join(home, "remote-identity.json"), home, env: { ...env, ...NO_CLI_ENV, HOME: home } });
    const run = packagedNode(s.command, s.args, how);
    child = reaper.spawnTracked(run.exe, run.args, s.options);
    pids.backend = child.pid;
    child.on("exit", (code, signal) => { exited = { code, signal }; settle(exited); });
    child.on("error", (e) => { tail = boundedTail(tail, `\nspawn error: ${e.message}`); exited ??= { code: -1, signal: null }; settle(exited); });
    child.stdout?.on("data", (d) => { tail = boundedTail(tail, d); });
    child.stderr?.on("data", (d) => { tail = boundedTail(tail, d); });
    child.stdin?.on("error", () => { /* the server is gone; its exit is reported */ });

    // 1. The backend answers.
    const readyBy = Date.now() + readyMs;
    let status = null;
    while (status === null) {
      if (exited) return fail(`backend${mode} exited before answering GET /api/cli (code ${exited.code}, signal ${exited.signal}); output tail:\n${output()}`);
      const left = readyBy - Date.now();
      if (left <= 0) return fail(`backend${mode} never answered GET /api/cli within ${seconds(readyMs)} (reaped); output tail:\n${output()}`);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/cli`, { signal: AbortSignal.timeout(Math.min(2000, left)) });
        status = res.status;
        await res.body?.cancel();
      } catch { await sleep(Math.min(200, Math.max(0, readyBy - Date.now()))); }
    }

    // 2. The lifeline: stdin closes, as when main ends; the server must go, port and all.
    child.stdin?.end();
    const gone = await within(exit, exitMs);
    if (!gone) return fail(`lifeline (#698): the backend${mode} was still running ${seconds(exitMs)} after its stdin closed (reaped); output tail:\n${output()}`);
    if (gone.code !== 0 || gone.signal !== null) return fail(`lifeline (#698): the backend${mode} ended with code ${gone.code}, signal ${gone.signal} when its stdin closed, expected exit 0; output tail:\n${output()}`);
    if (await portOpen(port)) return fail(`lifeline (#698): port ${port} still accepts connections after the backend${mode} exited (reaped); output tail:\n${output()}`);

    // 3. The collector: rows on stdin, one liveness per row on stdout; none in, none out.
    const col = packagedNode(s.command, [collector], how);
    const r = await reaper.runTracked(col.exe, col.args, { timeout: collectorMs, env: s.options.env, cwd: home, input: "[]" });
    pids.collector = r.pid;
    const said = `${String(r.stdout)}\n${String(r.stderr || "")}`.trim().slice(-500) || "(no output)";
    if (r.timedOut) return fail(`collector${mode} did not answer within ${seconds(collectorMs)} (group killed): ${said}`);
    if (r.code !== 0) return fail(`collector${mode} failed (exit ${r.code}): ${said}`);
    if (String(r.stdout).trim() !== "[]") return fail(`collector${mode} answered ${JSON.stringify(String(r.stdout).slice(0, 200))} to [], expected []`);

    const appImage = platform === "linux" ? ", nor the AppImage's launcher and runtime (APPDIR, its PATH and library-path entries): this ran the unpacked build" : "";
    return {
      ok: true, pids,
      detail: `backend, lifeline and collector run as Node under the packaged executable${mode}`,
      lines: [
        `backend: ${bin} started through serverSpawnSpec as Node under the packaged executable${mode}, no CLI discoverable, answered GET /api/cli (HTTP ${status})`,
        `lifeline (#698): closing the backend's stdin ended it (exit 0) and closed port ${port}`,
        `collector: ${collector} run as Node under the packaged executable${mode} answered [] to []`,
        `not exercised by this phase: the GUI (phase 5)${appImage}`,
      ],
    };
  } finally {
    if (child) {
      reaper.reapGroup(child);
      if (!exited) await within(exit, 5000);
    }
    rmSync(home, { recursive: true, force: true });
  }
}
