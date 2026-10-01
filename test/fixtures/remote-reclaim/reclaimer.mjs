// Two processes reclaiming one dead cache write lock (test/remote-partial.test.mjs, awebai/oats#386 review).
// Mode A pauses right before its unlink of the dead lock and starts mode B; B must not get the lock while A is
// paused. Each process "fetches" through an injected exec; A reports whether B was fetching at the same time.
// argv: <A|B> <lib/remote.mjs url> <work dir>
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [mode, remoteUrl, base] = process.argv.slice(2);
const cacheDir = join(base, "cache"), remote = join(base, "remote");
const lock = join(cacheDir, ".locks", `${createHash("sha256").update(`local/${remote}`).digest("hex")}.lock`);
const active = join(base, "B-active"), report = join(base, "report.json");
let child = null, bActiveDuringPause = null;
if (mode === "A") {
  fs.mkdirSync(join(cacheDir, ".locks"), { recursive: true });
  fs.writeFileSync(lock, JSON.stringify({ pid: 99_999_999, token: "dead".repeat(6), startedAt: "2026-01-01T00:00:00.000Z" }) + "\n");
  const unlink = fs.unlinkSync;
  let paused = false;
  fs.unlinkSync = function (path, ...rest) {
    if (path === lock && !paused) {
      paused = true; // descheduled between the reclaim's last check and its unlink
      child = spawn(process.execPath, [fileURLToPath(import.meta.url), "B", remoteUrl, base], { stdio: "inherit" });
      const until = Date.now() + 1500;
      while (!fs.existsSync(active) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      bActiveDuringPause = fs.existsSync(active);
    }
    return unlink.call(this, path, ...rest);
  };
  syncBuiltinESMExports();
}
const { observeRemote, runGit } = await import(remoteUrl);
const oid = "a".repeat(40);
let fetched = false, simultaneous = null;
const ok = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
const exec = async (args, options) => {
  if (args[0] === "--version") return { ...ok, stdout: Buffer.from("git version 2.54.0\n") };
  if (args.includes("rev-parse")) return { ...ok, stdout: Buffer.from(fetched ? `${oid}\n` : "") };
  if (args.includes("update-ref") || args.includes("config")) return ok;
  if (args.includes("fetch")) {
    if (mode === "B") { fs.writeFileSync(active, String(process.pid)); await new Promise((r) => setTimeout(r, 500)); fs.unlinkSync(active); }
    else simultaneous = fs.existsSync(active);
    fetched = true;
    return ok;
  }
  return runGit(args, options);
};
await observeRemote(remote, { at: oid, cacheDir, exec });
if (mode === "A") {
  await new Promise((r) => (child ? child.on("close", r) : r()));
  fs.writeFileSync(report, JSON.stringify({ bActiveDuringPause, simultaneous, lockLeft: fs.existsSync(lock) }));
}
