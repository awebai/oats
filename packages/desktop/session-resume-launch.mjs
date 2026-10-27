/* oats desktop — resume lost sessions (main).

   The shared trigger (packages/client/session-resume-trigger.mjs) decides when the kernel's machine sweep
   `oats session resume --json` runs; the Desktop owns no session: the kernel resumes them. This module is
   that trigger's wiring in main, with main's IO injected: the reading's routing, the notices queue and its
   IPC. main.mjs only builds it, arms it with `launch()` after the startup's deployments-list step settles
   (its first run imports the Desktop's saved deployments into the machine registry the sweep reads), and
   hands it each accepted /api/panel reply's instance rows with `observed()`.

   - A sweep's child is the runner's default exec's (file-output-exec.mjs: detached, output in files):
     nothing here holds it, so quitting Desktop never cancels it. Never add the trigger to shutdown(), the
     terminal broker or the server's lifetime; `dispose()` is for tests and the TUI.
   - A `notice` reading queues its summary and every live window hears `session-resume:ready`, on each new
     one. `session-resume:take` hands over every pending summary, oldest first, and clears them; at most
     `cap` are pending, a new one past it drops the oldest.
   - `failed` logs one line with its code only: no kernel text is logged. `quiet`, `busy` and
     `unsupported` leave nothing. */

const CODE = /^E_[A-Z0-9_]{1,64}$/;

/** Send a payload-less `channel` to every window whose page is alive; a closing window is skipped. */
export function sendToLiveWindows(windows, channel) {
  for (const win of windows) {
    try { if (!win.webContents.isDestroyed()) win.webContents.send(channel); } catch { /* closing window */ }
  }
}

/** The pending summaries: `push(summary)` queues one (past `cap`, the oldest goes); `take()` returns them,
 * oldest first ([] when none), and clears them. */
export function createResumeNotices({ cap = 10 } = {}) {
  let pending = [];
  return {
    push(summary) { pending.push(summary); if (pending.length > cap) pending.splice(0, pending.length - cap); },
    take() { const all = pending; pending = []; return all; },
  };
}

/**
 * The trigger, built with main's reading routing; returns what `createTrigger` made.
 * @param {object} io
 * @param {(options: object) => object} io.createTrigger  createResumeTrigger (its run and read are its defaults)
 * @param {() => object|null|Promise<object|null>} io.cli  the settled CLI probe, or null
 * @param {{ push: (summary: object) => void }} io.notices  createResumeNotices
 * @param {() => void} io.broadcast                        `session-resume:ready` to every live window
 * @param {(line: string) => void} io.error                a failed sweep
 */
export function createResumeWiring({ createTrigger, cli, notices, broadcast, error }) {
  return createTrigger({
    cli,
    onReading(reading) {
      if (reading?.kind === "notice") { notices.push(reading.summary); broadcast(); }
      else if (reading?.kind === "failed") error(`oats-desktop: the session resume sweep failed: ${typeof reading.code === "string" && CODE.test(reading.code) ? reading.code : "E_CLI_PROTOCOL"}`);
    },
  });
}

/** The one channel, behind main's trusted-frame `guard` first: every pending summary, taken. */
export function installResumeHandlers({ ipc, guard, notices }) {
  ipc.handle("session-resume:take", (e) => { guard(e); return notices.take(); });
}
