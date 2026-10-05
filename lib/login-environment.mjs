// The user's login environment, read when the kernel creates the OATS tmux server (awebai/oats#616).
//
// A tmux server keeps the environment of the process that starts it, and every pane on it inherits
// that. When the kernel starts the server it gives it what the user's own login shell sets up (the
// PATH a version manager activates, an agent socket an rc file exports), read as data, never the
// creator's ambient environment: the creator may be an agent instance, whose identity, credentials
// and harness variables must not become the server's. docs/execution-targets.md owns the rule.
//
// How: the login shell from the password database (os.userInfo().shell, never the creator's SHELL),
// one of bash, zsh or fish, runs `-l -i -c '<node> -e <emitter>'`, started from a fixed seed in the
// OS user's home directory. The emitter writes JSON.stringify(process.env) to file descriptor 3, a
// pipe this process created for nothing else: the shell's stdout and stderr are discarded, so rc
// chatter, prompts and text shaped like assignments never mix with the answer. No value goes into
// argv, a file, a log or a diagnostic. The answer is accepted only whole: exit status 0, at most
// 1 MiB, one JSON object whose values are all strings, plain identifiers as names, HOME and PATH
// present. Nothing in it is evaluated.
//
// Bounded: the shell runs in its own process group. The deadline (5 s) ends the read even when a
// descendant still holds the data descriptor after the shell exited; then that group, and only that
// group, gets SIGKILL. A descendant that made its own session or group (a daemon) is outside it, and
// group cleanup does not promise to end it.
//
// Imports nothing but node's own modules: the kernel stays dependency-free.
import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { userInfo } from "node:os";
import { basename } from "node:path";
import { killGroup } from "./process-group.mjs";

/** The session variables the seed carries: what lets the user's setup reach their agent socket and
 *  display. Per name, the first source where the name is present (an empty value counts) is used. */
export const LOGIN_SESSION_ENV = ["SSH_AUTH_SOCK", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"];
/** The shells whose `-l -i -c` and single quotes this relies on. Any other is an acquisition failure. */
export const LOGIN_SHELLS = ["bash", "zsh", "fish"];
export const LOGIN_CAPTURE_TIMEOUT_MS = 5000;
export const LOGIN_CAPTURE_MAX_BYTES = 1024 * 1024;
const SEED_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PLATFORM_READ_TIMEOUT_MS = 2000;
// Loops until every byte is written: fd 3 is a blocking pipe in the emitter.
const EMITTER = `const f=require("fs"),b=Buffer.from(JSON.stringify(process.env));for(let o=0;o<b.length;)o+=f.writeSync(3,b,o)`;
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * Read the login environment. `creatorEnv`: the creating process's environment (its locale names,
 * and its session variables when it is not an instance). `instance`: whether the creator is an
 * instance; then `recorded` is the global environment of the server its home records, as the strict
 * reader read it (null when it could not be read). `shell` replaces the password database's shell:
 * a test seam only. → `{ env, notes }` (env as the shell's environment ended up, unfiltered) or
 * `{ failure, notes }`: why, in words that hold no value. `notes`: what a person should know even on
 * success (a platform session that could not be read), also without values; a caller reports them
 * only with a successful capture, so a failure is one line.
 */
export function captureLoginEnvironment({ creatorEnv = process.env, instance = false, recorded = null, shell: seam, timeoutMs = LOGIN_CAPTURE_TIMEOUT_MS } = {}) {
  const notes = [];
  let user;
  try { user = userInfo(); } catch { return { failure: "your user has no password database entry", notes }; }
  const shell = seam || user.shell;
  if (!shell) return { failure: "your user has no login shell in the password database", notes };
  if (!LOGIN_SHELLS.includes(basename(shell))) return { failure: `your login shell (${basename(shell)}) is not bash, zsh or fish`, notes };
  // Nothing is read for a shell that cannot run (the user session included).
  try { accessSync(shell, fsConstants.X_OK); } catch (e) { return { failure: `your login shell could not be started (${e.code || "error"})`, notes }; }
  const seed = { HOME: user.homedir, USER: user.username, LOGNAME: user.username, SHELL: user.shell ?? shell, PATH: SEED_PATH, TERM: "dumb" };
  for (const name of ["LANG", "LC_ALL", "LC_CTYPE"]) if (creatorEnv[name] !== undefined) seed[name] = creatorEnv[name];
  Object.assign(seed, sessionVariables({ creatorEnv, instance, recorded, notes }));
  const r = spawnSync(shell, ["-l", "-i", "-c", `${sq(process.execPath)} -e ${sq(EMITTER)}`], {
    cwd: user.homedir, env: seed, stdio: ["ignore", "ignore", "ignore", "pipe"],
    timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: LOGIN_CAPTURE_MAX_BYTES, detached: true, windowsHide: true,
  });
  // The deadline or the size limit ended it: whatever of its group is left (a descendant holding the
  // data descriptor, a shell still in its rc) is killed. Only this group, only then.
  if (r.error?.code === "ETIMEDOUT" || r.error?.code === "ENOBUFS" || r.signal) killGroup(r);
  if (r.error?.code === "ETIMEDOUT") return { failure: `your login shell did not answer within ${Math.round(timeoutMs / 1000)} s`, notes };
  if (r.error?.code === "ENOBUFS") return { failure: "its answer was larger than 1 MiB", notes };
  if (r.error) return { failure: `your login shell could not be started (${r.error.code || "error"})`, notes };
  if (r.signal) return { failure: `your login shell was ended by ${r.signal}`, notes };
  if (r.status !== 0) return { failure: `your login shell exited with status ${r.status}`, notes };
  const data = r.output?.[3];
  if (!data?.length) return { failure: "your login shell gave no answer", notes };
  if (data.length > LOGIN_CAPTURE_MAX_BYTES) return { failure: "its answer was larger than 1 MiB", notes };
  let env;
  try { env = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); } catch { return { failure: "its answer was not one complete JSON object", notes }; }
  if (!env || typeof env !== "object" || Array.isArray(env)) return { failure: "its answer was not one complete JSON object", notes };
  const names = Object.keys(env);
  if (names.some((name) => typeof env[name] !== "string")) return { failure: "its answer held a value that is not text", notes };
  if (names.some((name) => !NAME.test(name))) return { failure: "its answer held a name that is not a plain identifier", notes };
  for (const name of ["HOME", "PATH"]) if (!Object.hasOwn(env, name)) return { failure: `its answer had no ${name}`, notes };
  return { env: Object.assign(Object.create(null), env), notes };
}

/** The seed's session variables, per name from the first source that has it: (a) the creator, only
 *  when it is not an instance; (b) for an instance, the recorded server's global environment; (c)
 *  the platform's user session, read as data. */
function sessionVariables({ creatorEnv, instance, recorded, notes }) {
  const out = {}, missing = [];
  for (const name of LOGIN_SESSION_ENV) {
    if (!instance && creatorEnv[name] !== undefined) out[name] = creatorEnv[name];
    else if (instance && recorded && Object.hasOwn(recorded, name)) out[name] = recorded[name];
    else missing.push(name);
  }
  if (!missing.length) return out;
  const platform = platformSession(missing, creatorEnv);
  if (platform.failure) notes.push(`could not read the user session's environment (${platform.failure}); ${missing.join(", ")} came only from your login shell`);
  for (const name of missing) if (Object.hasOwn(platform.env, name)) out[name] = platform.env[name];
  return out;
}

/** The user session's variables of `names`: `systemctl --user show-environment` on Linux,
 *  `launchctl getenv NAME` on macOS, each bounded, never through a shell. A failed or unavailable
 *  read, a timeout or a missing tool leave every name absent. → `{ env, failure? }` */
function platformSession(names, creatorEnv) {
  const run = (file, args) => spawnSync(file, args, { env: creatorEnv, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: PLATFORM_READ_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: LOGIN_CAPTURE_MAX_BYTES, windowsHide: true });
  const why = (r, tool) => r.error ? (r.error.code === "ENOENT" ? `${tool} was not found` : r.error.code === "ETIMEDOUT" ? `${tool} timed out` : `${tool} failed (${r.error.code})`) : r.status !== 0 ? `${tool} exited with status ${r.status ?? r.signal}` : null;
  if (process.platform === "linux") {
    const r = run("systemctl", ["--user", "show-environment"]);
    const failure = why(r, "systemctl --user show-environment");
    return failure ? { env: {}, failure } : { env: parseSystemdEnvironment(r.stdout, names) };
  }
  if (process.platform === "darwin") {
    const env = {};
    for (const name of names) {
      const r = run("launchctl", ["getenv", name]);
      const failure = why(r, "launchctl getenv");
      if (failure) return { env, failure };
      const value = r.stdout.replace(/\n$/, "");
      if (value !== "") env[name] = value; // empty output: absent
    }
    return { env };
  }
  return { env: {} };
}

/**
 * `systemctl --user show-environment` read as data: lines `NAME=value`. A value systemd printed in
 * its `$'…'` C-escaped form (\a \b \e \f \n \r \t \v \\ \' \" \ooo \xHH) is decoded, as bytes, then as
 * UTF-8; one that cannot be decoded leaves its name absent. Only the names asked for are kept.
 */
export function parseSystemdEnvironment(text, names = LOGIN_SESSION_ENV) {
  const env = {};
  for (const line of String(text).split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const name = line.slice(0, eq), raw = line.slice(eq + 1);
    if (!names.includes(name)) continue;
    if (!raw.startsWith("$'")) { env[name] = raw; continue; }
    const value = decodeCEscaped(raw);
    if (value !== null) env[name] = value;
  }
  return env;
}
const SIMPLE_ESCAPES = { a: 7, b: 8, e: 27, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, "'": 39, "\"": 34 };
function decodeCEscaped(raw) {
  if (!raw.endsWith("'") || raw.length < 3) return null;
  const body = raw.slice(2, -1);
  const bytes = [];
  for (let i = 0; i < body.length; i++) {
    const c = String.fromCodePoint(body.codePointAt(i));
    if (c === "'") return null; // an unescaped quote cannot be inside
    if (c !== "\\") { bytes.push(...Buffer.from(c, "utf8")); i += c.length - 1; continue; }
    const next = body[i + 1];
    if (next !== undefined && Object.hasOwn(SIMPLE_ESCAPES, next)) { bytes.push(SIMPLE_ESCAPES[next]); i += 1; continue; }
    const oct = /^[0-7]{3}/.exec(body.slice(i + 1, i + 4));
    if (oct && parseInt(oct[0], 8) < 256) { bytes.push(parseInt(oct[0], 8)); i += 3; continue; }
    const hex = /^x([0-9A-Fa-f]{2})/.exec(body.slice(i + 1, i + 4));
    if (hex) { bytes.push(parseInt(hex[1], 16)); i += 3; continue; }
    return null;
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes)); } catch { return null; }
}
