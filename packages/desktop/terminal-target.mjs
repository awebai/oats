// Closed admission for the two terminal adapters, a tmux session and remote. No
// target discovery or caller-owned executable/env/owner/window authority is
// introduced here. A Herdr session target is refused with E_HERDR_REMOVED.
import { tmuxAttachTarget } from './tmux-target.mjs';
import { tmuxSocketArgs } from './local-tmux-io.mjs';
import { remoteTargetKey } from './remote-target.mjs';
import { HERDR_REMOVED, terminalGeometry } from '../client/terminal-contract.mjs';

const invalid = () => { throw new Error('Invalid terminal target'); };
const closed = (v, keys) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) invalid();
};
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
export function admitTerminalTarget(input) {
  if (input && typeof input === 'object' && Object.hasOwn(input, 'sessionTarget')) throw Object.assign(new Error(HERDR_REMOVED), { code: 'E_HERDR_REMOVED' });
  closed(input, ['session', 'window', 'socket', 'remote', 'cols', 'rows']);
  const cols = input.cols === undefined ? 80 : input.cols, rows = input.rows === undefined ? 24 : input.rows;
  if (!terminalGeometry(cols, rows)) invalid();
  const families = [input.session !== undefined, input.remote !== undefined].filter(Boolean).length;
  if (families !== 1) invalid();
  let key, spec;
  if (input.remote !== undefined) {
    if (input.window !== undefined || input.socket !== undefined) invalid();
    closed(input.remote, ['serverId', 'instance', 'home']);
    const { serverId, instance, home } = input.remote;
    if (!text(serverId, 64) || !text(instance, 128) || !text(home, 4096)) invalid();
    const remote = Object.freeze({ serverId, instance, home });
    key = remoteTargetKey(remote); spec = { remote, cols, rows };
  } else {
    const { session } = input;
    if (!text(session, 128)) invalid();
    let window = input.window;
    if (window !== undefined && window !== null) {
      if (typeof window === 'number') { if (!Number.isSafeInteger(window) || window < 0) invalid(); window = String(window); }
      if (!text(window, 128)) invalid();
    } else window = undefined;
    const socket = input.socket === null || input.socket === '' ? undefined : input.socket;
    if (socket !== undefined && !text(socket, 4096)) invalid();
    tmuxSocketArgs(socket); tmuxAttachTarget(session, window);
    key = JSON.stringify(['tmux', session, window ?? null, socket ?? null]);
    spec = { session, ...(window !== undefined ? { window } : {}), ...(socket !== undefined ? { socket } : {}), cols, rows };
  }
  return Object.freeze({ key, spec: Object.freeze(spec) });
}
