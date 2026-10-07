/** Launch-only tmux observations. Exact visible bytes, never scrollback or
 * joined wrapped lines; both identity/geometry reads must agree. */
import { execFileSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';

function budget(timeout) {
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('invalid launch timeout');
  const deadline = performance.now() + timeout;
  return () => {
    const left = deadline - performance.now();
    if (left <= 0) throw new Error('launch geometry timeout');
    return left;
  };
}

export const LAUNCH_PANE_FORMAT = '#{window_id}\t#{pane_id}\t#{pane_pid}';
const SNAPSHOT_FORMAT = `${LAUNCH_PANE_FORMAT}\t#{pane_width}\t#{pane_height}\t#{window_panes}`;
export function launchPaneTarget(socket, output) {
  const fields = String(output).trim().split('\t');
  if (!isAbsolute(socket || '') || fields.length !== 3 || !/^@\d+$/.test(fields[0]) || !/^%\d+$/.test(fields[1]) || !/^[1-9]\d*$/.test(fields[2])) throw new Error('invalid launch pane identity');
  return { socket, windowId: fields[0], paneId: fields[1], pid: fields[2] };
}
export function launchPromptTransport(io) {
  const run = (target, args, timeout) => {
    if (!isAbsolute(target.socket || '') || !/^%\d+$/.test(target.paneId || '') || !Number.isFinite(timeout) || !(timeout > 0)) throw new Error('invalid launch target');
    return String((io?.exec || execFileSync)('tmux', ['-u', '-S', target.socket, ...args], {
      encoding: 'utf8', timeout: Math.max(1, Math.floor(timeout)), killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }));
  };
  const pins = new WeakMap();
  const transport = {
    // Called only before this invocation respawns an already-owned exact pane.
    identity(socket, paneId) {
      return launchPaneTarget(socket, run({socket, paneId}, ['display-message', '-p', '-t', paneId, LAUNCH_PANE_FORMAT], 1000));
    },
    snapshot(target, timeout) {
      const out = run(target, ['display-message', '-p', '-t', target.paneId, SNAPSHOT_FORMAT, ';',
        'capture-pane', '-p', '-t', target.paneId, ';',
        'display-message', '-p', '-t', target.paneId, SNAPSHOT_FORMAT], timeout);
      const lines = out.split('\n');
      if (lines.at(-1) === '') lines.pop();
      const first = lines.shift(), last = lines.pop();
      if (first !== last) throw new Error('launch pane identity or geometry changed');
      const fields = first?.split('\t') || [];
      if (fields.length !== 6 || fields[5] !== '1' || !/^[1-9]\d*$/.test(fields[3]) || !/^[1-9]\d*$/.test(fields[4])) throw new Error('launch pane is not exclusively owned');
      const actual = launchPaneTarget(target.socket, fields.slice(0, 3).join('\t'));
      if (actual.windowId !== target.windowId || actual.paneId !== target.paneId || actual.pid !== String(target.pid)) throw new Error('launch pane replaced');
      if (lines.length !== Number(fields[4])) throw new Error('incomplete visible capture');
      return { ...actual, width: Number(fields[3]), height: Number(fields[4]), text: lines.join('\n') + '\n' };
    },
    // Pin only an exclusively owned window. Tokens are invocation-local and
    // cannot be reconstructed from an event receipt or another transport.
    pin(target, geometry, timeout) {
      if (!Number.isSafeInteger(geometry?.width) || geometry.width < 1 || !Number.isSafeInteger(geometry?.height) || geometry.height < 1) throw new Error('invalid launch geometry');
      const remaining = budget(timeout);
      const before = transport.snapshot(target, remaining());
      const windowSize = run(target, ['show-options', '-w', '-q', '-v', '-t', target.windowId, 'window-size'], remaining()).trim();
      if (!['', 'largest', 'smallest', 'manual', 'latest'].includes(windowSize)) throw new Error('invalid window-size policy');
      // An empty option is inherited; restoration must unset our local override.
      const token = Object.freeze({ previous: Object.freeze({ width: before.width, height: before.height, windowSize }) });
      pins.set(token, { target: { ...target }, previous: token.previous });
      try {
        transport.snapshot(target, remaining());
        run(target, ['set-option', '-w', '-t', target.windowId, 'window-size', 'manual', ';',
          'resize-window', '-t', target.windowId, '-x', String(geometry.width), '-y', String(geometry.height)], remaining());
        const after = transport.snapshot(target, remaining());
        if (after.width !== geometry.width || after.height !== geometry.height) throw new Error('launch geometry pin failed');
        return token;
      } catch (error) {
        // A failed command may already have changed the option/dimensions.
        try { transport.restore(target, token, 3000); error.geometryRestored = true; }
        catch { error.geometryRestoreFailed = true; }
        throw error;
      }
    },
    restore(target, token, timeout) {
      const remaining = budget(timeout);
      const saved = pins.get(token);
      if (!saved || ['socket', 'windowId', 'paneId', 'pid'].some(key => String(saved.target[key]) !== String(target[key]))) throw new Error('invalid launch geometry token');
      // Consume even on failure: no retries can resize a replacement process.
      pins.delete(token);
      transport.snapshot(target, remaining());
      const { width, height, windowSize } = saved.previous;
      const reset = windowSize === ''
        ? ['set-option', '-w', '-u', '-t', target.windowId, 'window-size']
        : ['set-option', '-w', '-t', target.windowId, 'window-size', windowSize];
      run(target, ['set-option', '-w', '-t', target.windowId, 'window-size', 'manual', ';',
        'resize-window', '-t', target.windowId, '-x', String(width), '-y', String(height), ';', ...reset], remaining());
      const after = transport.snapshot(target, remaining());
      const restoredPolicy = run(target, ['show-options', '-w', '-q', '-v', '-t', target.windowId, 'window-size'], remaining()).trim();
      if (after.width !== width || after.height !== height || restoredPolicy !== windowSize) throw new Error('launch geometry restoration failed');
      return { status: 'restored' };
    },
    send(target, key, timeout) {
      if (key !== 'Enter') throw new Error('invalid launch action');
      run(target, ['send-keys', '-t', target.paneId, key], timeout);
      return { status: 'submitted' };
    },
  };
  return transport;
}
