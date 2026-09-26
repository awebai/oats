/** Deliver a composed review-threads block into an instance's own anchored tmux target: ONE
 * bracketed paste (`paste-buffer -p`, `-r` so tmux adds no CR), never send-keys, never Enter.
 * The per-request buffer is deleted on every path: `-d` on success, an explicit delete-buffer on
 * any failure after load-buffer. The block itself carries no CR/LF (review-threads.mjs). */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

export function createReviewPaste({ exec = execFileSync, find, tmuxTarget, random = () => randomBytes(8).toString('hex') }) {
  /** null when the target can take a paste, else a stable code. */
  function check(target) {
    const inst = find(target);
    if (!inst) return 'E_NOT_RUNNING';
    if (inst.server || inst.remote) return 'E_REMOTE_TERMINAL';
    if (inst.running !== true) return 'E_NOT_RUNNING';
    try { tmuxTarget(inst); } catch { return 'E_TERMINAL_UNSUPPORTED'; }
    return null;
  }
  function paste(target, text) {
    const refused = check(target);
    if (refused) return refused;
    if (typeof text !== 'string' || !text || /[\r\n]/.test(text)) return 'E_BAD_ARGS';
    const inst = find(target), name = `oatsrt-${random()}`;
    let loaded = false;
    try {
      exec('tmux', ['load-buffer', '-b', name, '-'], { input: text, timeout: 4000 });
      loaded = true;
      exec('tmux', ['paste-buffer', '-p', '-r', '-d', '-b', name, '-t', tmuxTarget(inst)], { timeout: 4000 });
      return null;
    } catch {
      if (loaded) { try { exec('tmux', ['delete-buffer', '-b', name], { timeout: 4000 }); } catch { /* gone already */ } }
      return 'E_PASTE_FAILED';
    }
  }
  return { check, paste };
}
