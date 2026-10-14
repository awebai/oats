/** Forget a remote instance its host no longer lists (#1131): `POST /api/server-forget` with the pressed
 * row's `{server, instance}` and nothing else. It runs `oats server forget <server> --instance <instance>
 * --json` (cli-adapter.mjs `cliServerForget`), which drops this computer's saved route to that instance
 * and changes nothing on the host. The argv is composed there from the two values; nothing else the
 * renderer sends reaches it. The caller re-reads the remote roster after every command that ran, whatever
 * it answered: the view is never edited from this answer.
 *
 *   forget(body) -> { http, ran, answer }
 *   answer = { status: 'forgotten', server, instance }       the kernel answered `forgotten: true` for them
 *          | { status: 'refused', reason: { code, message } } the kernel's refusal, its message as printed
 *          | { status: 'unknown', reason: { code } }          no kernel answer: a timeout, no envelope, a crash
 *          | { status: 'not-run', reason: { code, message } } nothing ran: E_BAD_ARGS, E_BUSY, E_FEATURE
 *
 * The kernel's `home` and `target` (a path and an ssh route on the host) never leave this module. A
 * refusal's message is the kernel's text, shown only through the renderer's display filter; an unknown
 * outcome carries the client's code alone, never a stderr or a thrown text. */
import { madeByKernel } from '../../client/kernel-made.mjs';

/** A row identity as the roster gave it: a string of 1 to 256 characters, no control character, never
 * option-shaped (cli-adapter.mjs `argText`, the rule of every other value this backend passes). */
export const forgetValue = v => typeof v === 'string' && v.length > 0 && v.length <= 256 && !v.startsWith('-') && !/[\x00-\x1f\x7f]/.test(v);

const NOT_RUN = Object.freeze({
  E_BAD_ARGS: [400, 'Forget needs the server and the instance of one roster row.'],
  E_BUSY: [409, 'A Forget for this instance is already running.'],
  E_FEATURE: [409, 'Forget needs a compatible installed OATS CLI.'],
});
export const forgetNotRun = code => ({ status: 'not-run', reason: { code, message: NOT_RUN[code][1] } });
const notRun = code => ({ http: NOT_RUN[code][0], ran: false, answer: forgetNotRun(code) });

/** What one command answered, as the renderer reads it. Only an error the installed CLI printed is a
 * refusal (kernel-made.mjs): one the adapter wrote (a timeout, no envelope, a nonzero exit with a success
 * envelope) says nothing about the route, so it is an unknown outcome. So is a success that is not
 * `forgotten: true` for exactly the asked row. */
export function forgetOutcome(envelope, server, instance) {
  if (envelope?.ok === true) {
    const r = envelope.result;
    return r?.forgotten === true && r.server === server && r.instance === instance ? { status: 'forgotten', server, instance }
      : { status: 'unknown', reason: { code: 'E_OUTCOME_UNKNOWN' } };
  }
  const error = envelope?.ok === false ? envelope.error : null;
  if (madeByKernel(error) && typeof error.code === 'string' && error.code) {
    return { status: 'refused', reason: { code: error.code, message: typeof error.message === 'string' ? error.message : '' } };
  }
  return { status: 'unknown', reason: { code: typeof error?.code === 'string' && /^E_CLI_[A-Z_]+$/.test(error.code) ? error.code : 'E_OUTCOME_UNKNOWN' } };
}

/** The CLI the rows came from: an accepted one that reads the remote roster (every such kernel answers forget,
 * 0.22.3). An array, never a string's `includes` (cli-locator.mjs requireRemoteSupport): it fails closed. */
const readsRemotes = cli => cli?.ok === true && Array.isArray(cli.remote) && cli.remote.includes('roster');

export function createServerForget({ adapter, cli }) {
  const running = new Set(); // `server\0instance` with a command in flight
  return {
    async forget(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2
        || !forgetValue(body.server) || !forgetValue(body.instance)) return notRun('E_BAD_ARGS');
      const state = cli();
      if (!readsRemotes(state)) return notRun('E_FEATURE');
      const { server, instance } = body, key = `${server}\0${instance}`;
      if (running.has(key)) return notRun('E_BUSY');
      running.add(key);
      try {
        let envelope = null;
        try { envelope = await adapter.cliServerForget(state.bin, { server, instance }); } catch { /* an unknown outcome */ }
        return { http: 200, ran: true, answer: forgetOutcome(envelope, server, instance) };
      } finally { running.delete(key); }
    },
  };
}
