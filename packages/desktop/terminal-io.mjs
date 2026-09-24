// Fixed adapter composition for the leased terminal broker. All effects can be
// replaced by memory recorders; no renderer-selected program/environment.
import { isAbsolute } from 'node:path';
import { admitTerminalTarget } from './terminal-target.mjs';
import { openTerm } from './tmux-target.mjs';
import { localTmuxIo, tmuxSocketArgs } from './local-tmux-io.mjs';
import { openHerdrTerm, readHerdrTarget } from './herdr-target.mjs';
import { prepareRemoteTerm, remoteTerminalEnvironment } from './remote-target.mjs';
import { copyTerminalAttachments, prepareTerminalAttachments } from './terminal-attachments.mjs';
import { runTerminalCommand } from './terminal-exec.mjs';

const changed = code => Object.assign(new Error('Terminal context changed'), { code });
const cliKey = cli => JSON.stringify([cli.bin, cli.version, [...(cli.remote || [])].sort(), [...(cli.features || [])].sort()]);
export async function readTerminalCli(base, { fetch: fetcher = fetch, signal, current }) {
  if (!current() || signal?.aborted) throw changed('E_TERM_CONTEXT_CHANGED');
  const origin = new URL(base);
  if (origin.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(origin.hostname)
    || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw changed('E_TERM_CONTEXT_CHANGED');
  const timeout = AbortSignal.timeout(5000);
  const response = await fetcher(`${origin.origin}/api/cli`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error' });
  if (!current() || signal?.aborted || !response.ok || !response.body?.getReader) throw changed('E_TERM_CONTEXT_CHANGED');
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (!current() || signal?.aborted) throw changed('E_TERM_CONTEXT_CHANGED');
      if (done) break;
      if (!(value instanceof Uint8Array) || (bytes += value.byteLength) > 1024 * 1024) throw new Error('CLI metadata exceeds budget');
      chunks.push(value);
    }
  } catch (error) { try { await reader.cancel(); } catch { /* already closed */ } throw error; }
  finally { reader.releaseLock(); }
  const cli = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
  if (cli?.ok !== true || typeof cli.bin !== 'string' || !isAbsolute(cli.bin) || cli.bin.length > 4096 || /[\x00-\x1f\x7f]/.test(cli.bin)
    || (cli.remote !== undefined && (!Array.isArray(cli.remote) || cli.remote.some(v => typeof v !== 'string')))
    || (cli.features !== undefined && (!Array.isArray(cli.features) || cli.features.some(v => typeof v !== 'string')))) throw new Error('CLI metadata unavailable');
  return cli;
}

export function createTerminalIo({ base, context, attachmentDirectory, spawnPty, execFileSync, sweep = () => {},
  fetch: fetcher = fetch, run = runTerminalCommand, env = process.env, fs,
}) {
  const readCli = control => readTerminalCli(base(), { fetch: fetcher, ...control });
  return {
    admit: admitTerminalTarget, copyAttachments: copyTerminalAttachments,
    async prepare(spec, control) {
      const cli = await readCli(control);
      const prepared = await prepareRemoteTerm(cli, spec.remote, { run, ...control });
      const fresh = await readCli(control);
      if (cliKey(cli) !== cliKey(fresh) || !control.current()) throw changed('E_TERM_CONTEXT_CHANGED');
      return prepared;
    },
    create(spec, prepared, { current }) {
      const check = () => { if (!current()) throw changed('E_TERM_CONTEXT_CHANGED'); };
      check();
      if (spec.remote) return {
        pty: spawnPty(prepared.binary, prepared.args, { name: 'xterm-256color', cols: Math.max(20, spec.cols), rows: Math.max(5, spec.rows), cwd: env.HOME, env: remoteTerminalEnvironment(env) }),
        killViewer: () => {}, // CLI/SSH child owns its remote viewer, not a durable source
      };
      if (spec.sessionTarget) return openHerdrTerm(spec, {
        inspect: target => { check(); const result = readHerdrTarget(target, execFileSync); check(); return result; },
        spawnPty: (args, cols, rows, environment) => { check(); return spawnPty('herdr', args, { name: 'xterm-256color', cols, rows, cwd: env.HOME, env: environment }); },
      });
      sweep(spec.socket); check();
      const local = localTmuxIo(spec.socket, { execFileSync, spawnPty, env });
      return openTerm(spec, {
        ...local,
        // Nonblocking cleanup lets the broker honor its2s pending receipt. The
        // same saved socket/exact owned viewer is used; no stronger signal.
        async cleanupViewer(viewer) {
          const prefix = tmuxSocketArgs(spec.socket), options = { encoding: 'utf8', timeout: 4000, maxBuffer: 1024 * 1024 };
          try { await run('tmux', [...prefix, 'kill-session', '-t', `=${viewer}`], options); }
          catch (error) {
            const result = await run('tmux', [...prefix, 'list-sessions', '-F', '#{session_name}'], options);
            if (result.stdout.split('\n').includes(viewer)) throw error;
          }
        },
        preflight: target => { check(); return local.preflight(target); },
        tmux: args => { if (args[0] !== 'kill-session') check(); return local.tmux(args); },
        tmuxOut: args => { if (args[0] !== 'list-sessions') check(); return local.tmuxOut(args); },
        spawnPty: (...args) => { check(); return local.spawnPty(...args); },
      });
    },
    async attachments(items, spec, control) {
      const epoch = spec.remote ? context() : undefined;
      const current = () => control.current() && (!spec.remote || (epoch !== null && epoch === context()));
      const check = () => { if (!current() || control.signal?.aborted) throw changed('E_TERM_ATTACHMENT_INTERRUPTED'); };
      check();
      const cli = spec.remote ? await readCli({ ...control, current }) : undefined;
      check();
      return prepareTerminalAttachments(items, { directory: attachmentDirectory(), remote: spec.remote, cli, fs,
        signal: control.signal, current,
        run: async (binary, args, options) => {
          const fresh = await readCli({ ...control, current }); check();
          if (cliKey(cli) !== cliKey(fresh)) throw changed('E_TERM_ATTACHMENT_INTERRUPTED');
          return run(binary, args, options);
        },
      });
    },
  };
}
