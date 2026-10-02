/** The message for a deployment the kernel could not observe (workspace
 * model v2). A missing advertised feature is named; a kernel refusal keeps
 * its code and message. The observed facts themselves render in the
 * Workspace view's Setup tab (workspace-catalog.mjs). */
const text = value => typeof value === 'string' && value ? value : null;
export function deploymentUnavailableText(deployment) {
  if (!deployment || deployment.status === 'pending') return 'Reading the deployment through the installed OATS CLI…';
  if (deployment.status === 'observed') return '';
  const reason = deployment.reason || {};
  if (reason.feature) return `The installed OATS CLI does not advertise ${reason.feature}, which the Desktop needs to show this deployment. Update OATS and retry.`;
  const code = text(reason.code), message = text(reason.message);
  return code && message ? `${code}: ${message}` : message || 'The deployment could not be observed.';
}

/* ── A deployment this Desktop's server does not serve, or does not answer for (#461) ──
 * Never a silent "pending": the roster and the overview show a failed state that names the
 * deployment, with Retry, and Re-add workspace when the server does not serve it. */
export const NOT_SERVED_CODE = 'E_WORKSPACE_NOT_SERVED';
export const NO_ANSWER_CODE = 'E_WORKSPACE_NO_ANSWER';
/** How long the server may keep answering "pending" for one deployment before the window says it
 * got no answer: the 30 s deployment read timeout (DEPLOYMENT_READ_TIMEOUT, deployment-read-cli.mjs,
 * which a renderer module cannot import) that bounds the first observation, plus 15 s for the cycle
 * around it (the 5 s focused cadence, the CLI probe that precedes the first read, the tmux liveness
 * child). An observation that lands later still replaces the error on the next poll. */
export const PENDING_LIMIT_MS = 30_000 + 15_000;

/** The body for E_WORKSPACE_NOT_SERVED, shared by the server's 404 and the Electron proxy's refusal. */
export function workspaceNotServed(workspace) {
  return { error: "This Desktop's server isn't serving this deployment.", code: NOT_SERVED_CODE, workspace };
}

/** The failed state's message: what happened, naming the deployment path. */
export function unservedText(code, path) {
  const where = typeof path === 'string' && path ? ` ${path}` : '';
  return code === NOT_SERVED_CODE
    ? `This Desktop's server isn't serving this deployment:${where}. Re-add the workspace, or retry.`
    : `No answer from the Desktop's server for this deployment:${where}. Retry, or check the OATS CLI.`;
}

/** An Error for the loading controller's failed state (message, code; `notServed` offers Re-add). */
export function unservedError(code, path) {
  const error = new Error(unservedText(code, path));
  error.code = code; error.workspace = path;
  return error;
}

/** Tracks how long one subject (a deployment on one connection) has been left without an observation.
 * `observe(subject, pending)` → true once the same subject has been pending for `limitMs`;
 * any other answer, or another subject, starts over. With `onOverdue`, the deadline is also a timer
 * of its own (`setTimeout`/`clearTimeout`): it fires `onOverdue(subject)` at the bound even when no
 * read settles and no new read is sent (a read that never answers holds the single-flight poll).
 * The timer belongs to the subject: an answer, another subject, `reset()` or `dispose()` cancels it. */
export function createPendingWatch({ limitMs = PENDING_LIMIT_MS, now = () => Date.now(), onOverdue = null,
  setTimeout: schedule = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: cancel = id => globalThis.clearTimeout(id) } = {}) {
  let subject = null, since = 0, timer = null;
  const stop = () => { if (timer !== null) { cancel(timer); timer = null; } };
  return {
    observe(next, pending) {
      if (!pending) { subject = null; stop(); return false; }
      if (next !== subject) {
        subject = next; since = now(); stop();
        if (typeof onOverdue === 'function') {
          const owner = next;
          timer = schedule(() => { timer = null; if (subject === owner) onOverdue(owner); }, limitMs);
        }
      }
      return now() - since >= limitMs;
    },
    reset() { subject = null; stop(); },
    dispose() { subject = null; stop(); },
  };
}
