/** Launch-only tmux observations. Exact visible bytes, never scrollback or
 * joined wrapped lines; both identity/geometry reads must agree. The transport
 * never resizes: matching is width-independent. */
import { execFileSync } from 'node:child_process';
import { isAbsolute } from 'node:path';

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
    send(target, key, timeout) {
      if (key !== 'Enter') throw new Error('invalid launch action');
      run(target, ['send-keys', '-t', target.paneId, key], timeout);
      return { status: 'submitted' };
    },
  };
  return transport;
}
