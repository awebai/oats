// The SSH contract exercised locally: a fake `ssh` on PATH records how it was
// called and runs the remote command through `<shell> -c`, as sshd runs it
// through the remote user's login shell, against the REAL kernel. What it
// proves is the routing, the quoting and the envelope handling, not that any
// real host works.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { linkExecutables } from "./host-fixture.mjs";

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

/** A PATH dir with: a fake ssh that logs its argv and runs the command
 *  locally through sh -c; fake tmux, and pi/claude in `tools` OFF that PATH
 *  (like ~/.local/bin on a real host: only a registration --path finds them). */
export function fakeBin(base) {
  const bin = join(base, "bin");
  linkExecutables(bin, ["node", "sh", "git", "which", "ps", "sed", "sleep"]);
  const log = join(base, "ssh.log");
  write(join(bin, "ssh"), `#!/bin/sh
printf '%s\\n' "$@" >> ${JSON.stringify(log)}
printf -- '--\\n' >> ${JSON.stringify(log)}
# drop options up to and including "--", then the host, then run the command word
# through the remote user's login shell, as sshd does, with SHELL naming it: FAKE_REMOTE_SHELL,
# else /bin/sh (never this machine user's own shell)
while [ "$1" != "--" ]; do shift; done
shift; shift
SHELL="\${FAKE_REMOTE_SHELL:-/bin/sh}"; export SHELL
exec "$SHELL" -c "$1"
`);
  const tools = join(base, "remote-tools"); mkdirSync(tools, { recursive: true });
  for (const rt of ["pi", "claude"]) write(join(tools, rt), "#!/bin/sh\nexit 0\n");
  write(join(bin, "tmux"), "#!/bin/sh\ncase \"$1\" in -V) echo 'tmux 3.4';; esac\nexit 0\n");
  for (const f of ["ssh", "tmux"]) chmodSync(join(bin, f), 0o755);
  for (const f of ["pi", "claude"]) chmodSync(join(tools, f), 0o755);
  return { bin, log, tools };
}

/** A fake login shell named `name` (zsh, or any name a test needs) in `dir`, for a fixture host
 *  whose user's home is $HOME: `-l` sources ~/.zprofile, `-i` sources ~/.zshrc (both only when
 *  present), then `-c` runs its command in the same shell, so what they export reaches it. Each call
 *  appends its flags to ~/.shell-calls. → the shell's absolute path. */
export function fakeLoginShell(dir, name = "zsh") {
  const shell = join(dir, name);
  write(shell, `#!/bin/sh
login= interactive= cmd=
while [ $# -gt 0 ]; do
  case "$1" in -l) login=1 ;; -i) interactive=1 ;; -c) shift; cmd="$1"; break ;; esac
  shift
done
printf '%s\\n' "\${login:+-l}\${interactive:+ -i}" >> "$HOME/.shell-calls"
if [ -n "$login" ] && [ -f "$HOME/.zprofile" ]; then . "$HOME/.zprofile"; fi
if [ -n "$interactive" ] && [ -f "$HOME/.zshrc" ]; then . "$HOME/.zshrc"; fi
eval "$cmd"
`);
  chmodSync(shell, 0o755);
  return shell;
}
