// Host-independent executables and shells for real, temporary process fixtures.
import assert from "node:assert/strict";
import { accessSync, chmodSync, constants, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function executable(name) {
  if (name === "node") return process.execPath;
  for (const dir of (process.env.PATH || "").split(delimiter).filter(isAbsolute)) {
    const candidate = join(dir, name);
    try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* next */ }
  }
  throw new Error(`test fixture requires ${name} on PATH`);
}

// Link individual tools, never their parent directories: node's bin directory
// can also contain a globally installed pi/claude/ssh.
export function linkExecutables(bin, names) {
  mkdirSync(bin, { recursive: true });
  for (const name of names) symlinkSync(executable(name), join(bin, name));
}

// Applies only to this test worker and its children. Even a server recreated by
// the kernel after kill-server uses the empty config and the fixture's shell.
// The wrapper also refuses any accidental access to the operator's tmux socket.
export function isolateSessionEnvironment(base, socket) {
  const original = { ...process.env };
  const tmux = executable("tmux");
  const bin = join(base, "system-bin");
  linkExecutables(bin, ["node", "sh", "bash", "cat", "env", "sleep", "git", "which", "ps"]);
  const wrapper = join(bin, "tmux");
  writeFileSync(wrapper, `#!/bin/sh
socket=
previous=
for arg do
  if [ "$previous" = -S ]; then socket=$arg; fi
  previous=$arg
done
if [ "$socket" != ${quote(socket)} ]; then
  printf '%s\\n' 'test tmux refused a non-fixture socket' >&2
  exit 1
fi
exec ${quote(tmux)} -f /dev/null "$@"
`);
  chmodSync(wrapper, 0o755);
  const home = join(base, "user-home");
  const config = join(home, ".config");
  mkdirSync(config, { recursive: true });
  for (const key of Object.keys(process.env)) {
    if (/^(OATS_|PI_AGENT)/.test(key) || ["TMUX", "TMUX_PANE", "ENV", "BASH_ENV"].includes(key)) delete process.env[key];
  }
  Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: config, ZDOTDIR: home, SHELL: "/bin/sh", PATH: bin, OATS_HOME_DIR: join(base, "oats-home") });
  return () => {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  };
}

// Readiness is a condition, not an assumed delay. A timeout must fail the test,
// including callers that only await this helper without asserting its return.
export async function waitUntil(predicate, description, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}
