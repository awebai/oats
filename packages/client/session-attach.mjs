// Remote terminal addressing is an installed-CLI operation, never a renderer
// supplied SSH command, executable path, socket or server registration.
//
// Opening an agent's terminal with the kernel's own viewer (`oats session attach`): the arguments
// of the viewer for this machine and for another, whether its detach key can be used, and, for
// another machine, the preflight (`oats session inspect`) that runs before the viewer starts.
//
// A failed `prepareRemoteTerm` throws one of these, and `preflightFailure` reads any of them:
//
//   code E_TERM_CONTEXT_CHANGED            the caller's `signal` aborted or its `current()` turned false
//   code E_TERM_REMOTE_NO_SSH,             the preflight's own outcomes: terminal-contract.mjs has a
//     E_TERM_REMOTE_UNREACHABLE,           sentence for each
//     E_TERM_PREPARE_TIMEOUT,
//     E_TERM_REMOTE_NO_ANSWER,
//     E_TERM_REMOTE_GONE, E_HERDR_REMOVED
//   any other refusal envelope             the kernel's refusal, or a host's relayed by it, with its
//                                          `code` and `message` as given (E_TERM_OPEN_FAILED and a
//                                          fixed message where it gave none)
//   code unsupported-remote-operation,     the installed CLI cannot do it: decided before any process
//     unsupported-detach-key
//   no code, or one that is not a string   the target was invalid, the CLI did not start, or it
//                                          answered no envelope
//
// Not loadable by a page: it reaches `node:` builtins through its runner.
import { requireRemoteSupport } from "./cli-locator.mjs";
import { runTerminalCommand } from './terminal-exec.mjs';
import { HERDR_REMOVED, terminalFailure, terminalMessage } from './terminal-contract.mjs';

/** The kernel feature of `session attach --detach-key` (docs/desktop-cli-api.md). */
export const DETACH_KEY_FEATURE = "session-attach-detach-key";
/** The kernel feature under which a roster group's `probe.features` is the host's own list
 *  (docs/desktop-cli-api.md, `probe.features`). Without it that key says nothing. */
const PROBE_FEATURES_FEATURE = "server-probe-features";
// Array.isArray, as in requireRemoteSupport: a string must not pass a gate that exists to fail closed.
const lists = (cli, feature) => cli?.ok === true && Array.isArray(cli.features) && cli.features.includes(feature);

/** This machine's CLI takes the key: an accepted probe (`cli.ok === true`) whose `features` is an
 *  array naming the feature. */
export function detachKeySupported(cli) {
  return lists(cli, DETACH_KEY_FEATURE);
}
/** The key can be offered for a row on another machine: this machine's CLI takes it and relays what
 *  each host lists about itself, the group's last roster read succeeded, and the host's own list
 *  names the feature. `group` is a group of `oats server roster --json` as read. `features: null`,
 *  a missing key and a failed read are unknown, and unknown is not supported; nothing is decided
 *  from a refusal and nothing probes. For what a client offers only: `sessionAttachArgv` does not
 *  ask it, because the kernel refuses a host without the feature and starts no viewer. */
export function hostDetachKeySupported(cli, group) {
  const probe = group?.probe;
  return detachKeySupported(cli) && lists(cli, PROBE_FEATURES_FEATURE)
    && probe?.ok === true && Array.isArray(probe.features) && probe.features.includes(DETACH_KEY_FEATURE);
}

const coded = (code, message) => Object.assign(new Error(message), { code });
const herdrRemoved = message => coded('E_HERDR_REMOVED', message);
const unreachable = () => coded('E_TERM_REMOTE_UNREACHABLE', 'the remote server could not be reached');
/** The CLI's JSON envelope, or null when it printed none. */
function envelopeOf(stdout) {
  let envelope;
  try { envelope = JSON.parse(stdout); } catch { return null; }
  return envelope?.schemaVersion === 1 && typeof envelope.ok === 'boolean' ? envelope : null;
}
/** What a refusal said, for each error `refusal` returns from its last line: the envelope's own
 * `code`, `message` and `details.fix`, each null where it gave no string. Kept on the error under this
 * module's own symbol, not enumerable and not writable, so the error thrown has the enumerable
 * properties it always had, the module holds no state, and an error made by hand (or a copy of one)
 * carries none; read by `preflightFailure` only. */
const KEPT_REFUSAL = Symbol('kept refusal');
const stringOrNull = value => (typeof value === 'string' ? value : null);
/** A refusal envelope as a coded error. The CLI reports ssh's own failure as E_SSH: a transport
 * failure, unless its details say ssh never started on this computer (nothing to retry); a 0.31
 * kernel's E_HERDR_REMOVED keeps its message; any other refusal keeps the host's code. */
function refusal(envelope) {
  const { code, message, details } = envelope.error || {};
  if (code === 'E_SSH' && details?.sshStarted === false) return coded('E_TERM_REMOTE_NO_SSH', 'ssh is not available on this computer');
  if (code === 'E_SSH') return unreachable();
  if (code === 'E_HERDR_REMOVED') return herdrRemoved(typeof message === 'string' && message ? message : HERDR_REMOVED);
  const error = coded(typeof code === 'string' && code ? code : 'E_TERM_OPEN_FAILED', message || 'remote session inspection failed');
  Object.defineProperty(error, KEPT_REFUSAL, { value: Object.freeze({ code: stringOrNull(code), message: stringOrNull(message), fix: stringOrNull(details?.fix) }) });
  return error;
}
/** What a failed preflight says. `error` is what `prepareRemoteTerm` threw; `server` is the label a
 * sentence names.
 *
 *   code      the terminal table's code for it (E_TERM_OPEN_FAILED for anything the table does not know)
 *   sentence  the table's sentence, naming `server` where it has a place for one
 *   said      null, or { code, message, fix }: what the kernel said (this machine's, or another
 *             host's relayed by it), only for a refusal kept as it came for which the table has no
 *             sentence of its own. Each is the envelope's own string or null, and `said` is null
 *             when all three are. Text from outside: a client draws `message` and `fix` with
 *             kernel-lines.mjs `kernelLines` and nothing else.
 *
 * Any other error has `said: null`, also one made by hand with a refusal's code and message: the
 * message of a CLI that did not start holds a path and is never shown. */
export function preflightFailure(error, server) {
  const code = terminalFailure(error?.code).code;
  const kept = code === 'E_TERM_OPEN_FAILED' && error !== null && typeof error === 'object' && Object.hasOwn(error, KEPT_REFUSAL) ? error[KEPT_REFUSAL] : undefined;
  const said = kept && (kept.code !== null || kept.message !== null || kept.fix !== null) ? { ...kept } : null;
  return { code, sentence: terminalMessage(error?.code, server), said };
}

/** A remote terminal is its server and its absolute home: routed as `--server S --home H`, never by a bare name. */
export function remoteTargetKey(remote) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(remote?.serverId || "")
    || !/^[a-z0-9][a-z0-9-]*$/.test(remote?.instance || "")) throw new Error("invalid remote terminal target");
  if (typeof remote.home !== "string" || !remote.home.startsWith("/") || remote.home.includes("\0")) throw new Error("invalid remote terminal home");
  return JSON.stringify(["remote", remote.serverId, remote.home]);
}
/** The arguments of the kernel's viewer (the binary is `cli.bin`), a new array each call.
 *
 *   target     { home } on this machine; { serverId, instance, home } on another (what
 *              `remoteTargetKey` admits, and it refuses as it always did)
 *   detachKey  undefined for none; else a non-empty string, appended as `--detach-key <key>`
 *
 * The client holds no copy of the kernel's key grammar: a key the kernel does not accept is the
 * kernel's refusal. A key for a CLI that does not take one throws `unsupported-detach-key`: a
 * kernel without the feature ignores the flag and opens a viewer with no exit, so the flag is
 * never tried (docs/desktop-cli-api.md). Its message is for a developer; a client decides what it
 * offers with `detachKeySupported`. */
export function sessionAttachArgv(cli, target, { detachKey } = {}) {
  let address;
  if (target?.serverId !== undefined) {
    remoteTargetKey(target);
    address = ["--server", target.serverId, "--home", target.home];
  } else {
    if (typeof target?.home !== "string" || !target.home.startsWith("/") || target.home.includes("\0")) throw new Error("invalid session home");
    address = ["--home", target.home];
  }
  if (detachKey === undefined) return ["session", "attach", ...address];
  if (typeof detachKey !== "string" || !detachKey) throw new TypeError("a detach key is a non-empty string");
  if (!detachKeySupported(cli)) throw Object.assign(new Error(`installed oats ${cli?.version || "unknown"} does not support session attach --detach-key; update the CLI`), { code: "unsupported-detach-key" });
  return ["session", "attach", ...address, "--detach-key", detachKey];
}
/** The preflight of an attach on another machine, and the viewer to start after it: { binary, args }.
 *
 *   run        the whole run of the CLI, in the shape of terminal-exec.mjs `runTerminalCommand`; a
 *              caller that passes it owns the run, and `exec` is then not used
 *   exec       what the default runner starts the CLI with, in `execFile`'s signature
 *   detachKey  as `sessionAttachArgv` takes it. The viewer's arguments are built before the
 *              inspect runs, so a key that cannot be used starts no process; the inspect never
 *              carries the key. */
export async function prepareRemoteTerm(cli, remote, { exec, run = (binary, args, options) => runTerminalCommand(binary, args, options, exec), signal, current = () => true, detachKey } = {}) {
  const check = () => { if (signal?.aborted || !current()) throw Object.assign(new Error('Terminal context changed'), { code: 'E_TERM_CONTEXT_CHANGED' }); };
  check();
  requireRemoteSupport(cli, "session");
  const bin = cli.bin;
  remoteTargetKey(remote);
  const address = ["--server", remote.serverId, "--home", remote.home];
  const args = sessionAttachArgv(cli, remote, { detachKey });
  check(); // actual execution owner, not only IPC admission
  let stdout;
  try {
    ({ stdout } = await run(bin, ["session", "inspect", ...address, "--json"], {
      encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024, shell: false, ...(signal ? { signal } : {}),
    }));
  } catch (error) {
    check();
    const envelope = typeof error?.stdout === 'string' ? envelopeOf(error.stdout) : null;
    if (envelope && !envelope.ok) throw refusal(envelope);
    // Killed by execFile at the deadline: a stalled link outlives ssh's keepalives (about 45 s),
    // so it is a timeout. A CLI that ended without a refusal, by a nonzero exit (255 included) or
    // a signal of its own, gave no answer: ssh's own failures arrive as E_SSH, so this is more
    // likely the local CLI. A CLI that never started keeps its own error.
    if (error?.killed) throw coded('E_TERM_PREPARE_TIMEOUT', 'remote session inspection timed out');
    if (Number.isInteger(error?.code) || error?.signal) throw coded('E_TERM_REMOTE_NO_ANSWER', 'the local oats gave no answer');
    throw error;
  }
  check();
  const envelope = envelopeOf(stdout);
  if (!envelope) throw new Error("remote session inspection answered no envelope");
  if (!envelope.ok) throw refusal(envelope);
  // A 0.31 kernel refuses a Herdr-recorded instance; an older one still reports its live Herdr
  // session. Neither is attached: the refusal keeps its code so the broker reports it.
  if (envelope.result?.backend === 'herdr') throw herdrRemoved(HERDR_REMOVED);
  if (envelope.result?.present !== true) throw coded('E_TERM_REMOTE_GONE', "remote terminal no longer exists");
  return { binary: bin, args };
}
