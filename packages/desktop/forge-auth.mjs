/** Closed-purpose ephemeral gh sign-in broker. No HTTP mutations, shell,
 * arbitrary PTY input, workspace targets, token custody or durable transcripts. */
import { randomBytes } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createAuthOutputFilter } from './forge-auth-output.mjs';
import { forgeEnvironment, forgeProfile, executableGh, ghVersion } from './forge-cli.mjs';
import { ref, hostName, loginName, forgeReason, FORGE_API } from './renderer/forge-contract.mjs';
export const AUTH_KEYS = Object.freeze({ enter: '\r', up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D',
  tab: '\t', escape: '\x1b', yes: 'y', no: 'n', interrupt: '\x03' });
const failed = code => ({ ok: false, reason: forgeReason(code) });
export function validConnection(v) {
  return v?.forgeApi === FORGE_API && ['connected', 'not-connected'].includes(v.status) && hostName(v.host)
    && ref(v.hostRef) && ref(v.connectionRef) && (v.status === 'connected' ? loginName(v.login) : v.login === null)
    && typeof v.cli?.bin === 'string' && isAbsolute(v.cli.bin) && !v.cli.bin.includes('\0')
    && ghVersion(`gh version ${v.cli.version}`) === v.cli.version && ref(v.cli.profile)
    && typeof v.cli.stamp === 'string' && /^[0-9:.]{1,128}$/.test(v.cli.stamp);
}
export async function verifyAuthCli(cli, run, env = forgeEnvironment()) {
  if (cli.profile !== forgeProfile(env)) return false;
  const file = executableGh(cli.bin);
  if (!file || file.bin !== cli.bin || file.stamp !== cli.stamp) return false;
  const result = await run(cli.bin, ['--version'], { timeout: 2000, limit: 16 * 1024 });
  const after = executableGh(cli.bin);
  return result.ok && result.exitCode === 0 && ghVersion(result.stdout) === cli.version && after?.stamp === cli.stamp;
}
export function createForgeAuthBroker({ readConnection, verify, launchPty, run, confirm, emit,
  alive: ownerAlive = owner => !owner.isDestroyed(), changed = () => {}, env = forgeEnvironment(), cwd = homedir(),
  checkBinary = cli => executableGh(cli.bin)?.stamp === cli.stamp,
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let operation = null, generation = 0;
  const alive = owner => { try { return ownerAlive(owner) === true; } catch { return false; } };
  const bump = () => { generation++; try { changed(generation); } catch { /* window teardown cannot break cleanup */ } };
  const send = (op, kind, data) => {
    try { if (alive(op.owner)) emit(op.owner, op.lease, kind, data); }
    catch { cancel(op, 'E_FORBIDDEN_FRAME'); }
  };
  const owns = op => operation === op && !op.ended && alive(op.owner);
  const match = (owner, lease) => operation?.owner === owner && operation?.lease === lease && owns(operation) ? operation : null;
  function finish(op, code = null) {
    if (op.ended) return; op.ended = true; clearTimer(op.timer); op.abort.abort();
    if (op.filter && alive(op.owner)) {
      const tail = op.filter.end(); if (tail) send(op, 'data', tail);
    }
    if (operation === op) operation = null;
    bump();
    send(op, 'exit', code ? failed(code) : { ok: true });
  }
  function cancel(op, code = 'E_AUTH_CANCELLED') {
    if (op.ended) return;
    op.cancelled = code; op.abort.abort();
    if (op.pty) {
      try { op.pty.kill('SIGKILL'); } catch { finish(op, code); }
      // Keep the resource slot until node-pty confirms this owned child exited.
    } else if (!op.committed) finish(op, code);
  }
  function reserve(owner, connectionRef, kind) {
    if (!alive(owner) || !ref(connectionRef)) return null;
    const op = { owner, connectionRef, kind, lease: randomBytes(32).toString('hex'), ended: false, abort: new AbortController() };
    operation = op; bump();
    op.timer = setTimer(() => cancel(op, 'E_AUTH_EXPIRED'), 15 * 60_000);
    return op;
  }
  async function read(op) {
    const snapshot = await readConnection(op.connectionRef, generation);
    if (!owns(op)) { cancel(op); return null; }
    if (!validConnection(snapshot)) return null;
    const verified = await verify(snapshot.cli);
    if (!owns(op)) { cancel(op); return null; }
    return verified ? snapshot : null;
  }
  async function connect(owner, connectionRef) {
    if (operation) {
      if (operation.owner === owner && operation.connectionRef === connectionRef && operation.kind === 'login' && operation.snapshot && owns(operation)) return { ok: true, lease: operation.lease, reused: true };
      return failed('E_FORGE_BUSY');
    }
    const op = reserve(owner, connectionRef, 'login'); if (!op) return failed('E_BAD_ARGS');
    try {
      const snapshot = await read(op);
      if (!owns(op)) return failed('E_AUTH_CANCELLED');
      if (!snapshot || snapshot.status !== 'not-connected') { finish(op, 'E_CONNECTION_CHANGED'); return failed('E_CONNECTION_CHANGED'); }
      op.snapshot = snapshot; op.preparedGeneration = generation;
      // Resize is the ready handshake: listeners are installed before any PTY
      // starts, so neither the device-code prompt nor an immediate exit is lost.
      return { ok: true, lease: op.lease, host: snapshot.host };
    } catch {
      if (!op.ended) cancel(op, 'E_GH_FAILED');
      return failed('E_GH_FAILED');
    }
  }
  function resize(owner, lease, cols, rows) {
    const op = match(owner, lease);
    if (!op || op.kind !== 'login' || !op.snapshot) return failed('E_FORBIDDEN_FRAME');
    if (!Number.isInteger(cols) || cols < 20 || cols > 300 || !Number.isInteger(rows) || rows < 5 || rows > 100) return failed('E_BAD_ARGS');
    if (op.cancelled) return failed(op.cancelled);
    if (!op.pty && (op.preparedGeneration !== generation || !checkBinary(op.snapshot.cli))) { finish(op, 'E_CONNECTION_CHANGED'); return failed('E_CONNECTION_CHANGED'); }
    try {
      if (op.pty) op.pty.resize(cols, rows);
      else {
        op.filter = createAuthOutputFilter(); op.bytes = 0;
        const args = ['auth', 'login', '--web', '--skip-ssh-key', '--hostname', op.snapshot.host];
        const pty = launchPty(op.snapshot.cli.bin, args, { name: 'xterm-256color', cols, rows, cwd, env: forgeEnvironment(env, true) });
        op.pty = pty;
        pty.onData(data => {
          if (!owns(op) || op.cancelled) return;
          op.bytes += Buffer.byteLength(data);
          if (op.bytes > 1024 * 1024) { cancel(op, 'E_FORGE_LIMIT'); return; }
          const output = op.filter.feed(data); if (output) send(op, 'data', output);
        });
        pty.onExit(({ exitCode }) => finish(op, op.cancelled || (exitCode === 0 ? null : 'E_GH_FAILED')));
      }
      return { ok: true };
    } catch { cancel(op, 'E_GH_FAILED'); return failed('E_GH_FAILED'); }
  }
  function key(owner, lease, name) {
    const op = match(owner, lease);
    if (!op?.pty || op.cancelled) return failed('E_FORBIDDEN_FRAME');
    if (!Object.hasOwn(AUTH_KEYS, name)) return failed('E_BAD_ARGS');
    try { op.pty.write(AUTH_KEYS[name]); return { ok: true }; } catch { return failed('E_GH_FAILED'); }
  }
  async function disconnect(owner, connectionRef) {
    if (operation) return failed('E_FORGE_BUSY');
    const op = reserve(owner, connectionRef, 'logout'); if (!op) return failed('E_BAD_ARGS');
    try {
      const before = await read(op);
      if (!owns(op)) return failed('E_AUTH_CANCELLED');
      if (!before || before.status !== 'connected') { finish(op, 'E_CONNECTION_CHANGED'); return failed('E_CONNECTION_CHANGED'); }
      const yes = await confirm({ owner, host: before.host, login: before.login, signal: op.abort.signal });
      if (!owns(op)) { cancel(op); return failed('E_AUTH_CANCELLED'); }
      if (yes !== true) { finish(op, 'E_AUTH_CANCELLED'); return failed('E_AUTH_CANCELLED'); }
      const after = await read(op);
      if (!owns(op)) return failed('E_AUTH_CANCELLED');
      if (!after || after.status !== before.status || after.login !== before.login || after.host !== before.host
        || JSON.stringify(after.cli) !== JSON.stringify(before.cli)) { finish(op, 'E_CONNECTION_CHANGED'); return failed('E_CONNECTION_CHANGED'); }
      op.committed = true;
      const result = await run(after.cli.bin, ['auth', 'logout', '--hostname', after.host, '--user', after.login], { timeout: 10_000, limit: 16 * 1024 });
      const code = result.ok && result.exitCode === 0 ? null : result.code || 'E_GH_FAILED';
      finish(op, code);
      // This is an action receipt, NEVER a disconnected-state assertion. The
      // generation event/next status read reports any newly active gh account.
      return code ? failed(code) : { ok: true, hostRef: after.hostRef };
    } catch {
      if (!op.ended) finish(op, 'E_GH_FAILED');
      return failed('E_GH_FAILED');
    }
  }
  return { connect, disconnect, resize, key, generation: () => generation,
    close(owner, lease) { const op = match(owner, lease); if (!op) return failed('E_FORBIDDEN_FRAME'); cancel(op); return { ok: true }; },
    invalidate: bump,
    dropOwner(owner) { if (operation?.owner === owner) cancel(operation); },
    dispose() { if (operation) cancel(operation); },
  };
}
