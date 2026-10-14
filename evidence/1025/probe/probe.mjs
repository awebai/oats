// Loaded with --import in a test worker. Logs every child the worker starts: whether it was given
// an `env` option, and whether process.env was then the object the process started with or a
// replacement. A child started with no `env` under a replacement gets, from Node v26.11.0, the
// process's real environment. Changes nothing of what is started.
import cp from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
const real = process.env, log = process.env.PROBE_LOG;
if (log && /\.test\.mjs$/.test(process.argv[1] ?? "")) {
  const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  for (const fn of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) {
    const original = cp[fn];
    cp[fn] = function (...args) {
      try {
        const options = args.slice(1).find(plain);
        const list = Array.isArray(args[1]) ? args[1] : [];
        const now = process.env, replaced = now !== real;
        const pick = (env) => ({ HOME: env.HOME ?? null, TMUX_TMPDIR: env.TMUX_TMPDIR ?? null, OATS_HOME_DIR: env.OATS_HOME_DIR ?? null });
        appendFileSync(log, JSON.stringify({ fn, cmd: basename(String(args[0]).split(" ")[0]), args: list.slice(0, 5).map(String), env: options && options.env !== undefined ? "given" : "none", replaced, real: pick(real), seen: pick(now) }) + "\n");
      } catch { /* the probe never fails a call */ }
      return original.apply(this, args);
    };
  }
  syncBuiltinESMExports();
}
