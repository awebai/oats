/* oats desktop — resume lost sessions when Desktop opens (main).

   Once per app launch, after the startup's deployments-list step settles (its first run imports the
   Desktop's saved deployments into the machine registry the sweep reads), main runs the kernel's
   machine sweep `oats session resume --json` (packages/client/session-resume-cli.mjs) and reads its
   answer (packages/client/session-resume.mjs). The Desktop owns no session: the kernel resumes them.
   This module is the trigger, the launch's pending notice and the preference, with main's IO
   injected; main.mjs only wires it.

   - The sweep runs only with a settled CLI that has the `session-resume` feature (else nothing, no
     log), and only when the preference is on. A missing preference file is on; one that cannot be
     read, is not JSON or has the wrong shape is off for this launch (one line logged): no session is
     started on an ambiguous preference. A change takes effect at the next launch.
   - Its child is the runner's default exec's (file-output-exec.mjs: detached, output in files): nothing
     here holds it, so quitting Desktop never cancels it. Never add it to shutdown(), the terminal
     broker or the server's lifetime.
   - A `notice` answer becomes the launch's pending summary and every live window hears
     `session-resume:ready`; the first `session-resume:take` gets it and clears it. `quiet` and
     `busy` leave nothing. `failed` logs one line with its code only: no kernel text is logged.
   - The preference file is `{"resumeAtLaunch": boolean}`, written atomically (a temporary file of its
     own in the same directory, synced, renamed over), as chord-family.mjs writes keys.json. */
import * as nodeFs from "node:fs";
import { dirname, join } from "node:path";

const CODE = /^E_[A-Z0-9_]{1,64}$/;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** The preference as main reads it: `{ resumeAtLaunch }`, with `malformed: true` when the file is there
 * and is not one (unreadable, not JSON, not exactly `{"resumeAtLaunch": boolean}`): off. No file is on. */
export function readResumePreference(file, fs = nodeFs) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (error) {
    return error?.code === "ENOENT" ? { resumeAtLaunch: true } : { resumeAtLaunch: false, malformed: true };
  }
  let value;
  try { value = JSON.parse(text); } catch { return { resumeAtLaunch: false, malformed: true }; }
  const keys = record(value) ? Object.keys(value) : [];
  if (keys.length !== 1 || keys[0] !== "resumeAtLaunch" || typeof value.resumeAtLaunch !== "boolean") return { resumeAtLaunch: false, malformed: true };
  return { resumeAtLaunch: value.resumeAtLaunch };
}

let written = 0;
/** Write the preference: `{ ok: true, resumeAtLaunch }`, or `{ ok: false, code }` with E_BAD_ARGS (not a
 * boolean; nothing touched) or E_PREFERENCE_WRITE (any step failed; the old file stays as it was and the
 * temporary one is removed). Never throws. `stamp` names the temporary file (tests). */
export function writeResumePreference(file, value, { fs = nodeFs, stamp = `${process.pid}.${Date.now()}.${++written}` } = {}) {
  if (typeof value !== "boolean") return { ok: false, code: "E_BAD_ARGS" };
  const dir = dirname(file), own = join(dir, `.session-resume.json.${stamp}.tmp`);
  const bytes = Buffer.from(`${JSON.stringify({ resumeAtLaunch: value })}\n`, "utf8");
  let fd = null, made = false;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fd = fs.openSync(own, "wx", 0o600);
    made = true;
    for (let at = 0; at < bytes.length;) at += fs.writeSync(fd, bytes, at, bytes.length - at);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = null;
    fs.renameSync(own, file);
    return { ok: true, resumeAtLaunch: value };
  } catch {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* the code says what failed */ }
    // Only a file this write made is removed: `wx` refuses a name that is already there, and that one is not ours.
    if (made) try { fs.unlinkSync(own); } catch { /* the rename may have taken it */ }
    return { ok: false, code: "E_PREFERENCE_WRITE" };
  }
}

/** Send a payload-less `channel` to every window whose page is alive; a closing window is skipped. */
export function sendToLiveWindows(windows, channel) {
  for (const win of windows) {
    try { if (!win.webContents.isDestroyed()) win.webContents.send(channel); } catch { /* closing window */ }
  }
}

/**
 * The launch's sweep. `start()` runs it at most once per instance (a second call returns the first's
 * promise) and never rejects; `take()` hands the pending summary over once (null after, and before).
 * @param {object} io
 * @param {() => Promise<object|null>} io.readCli    the settled CLI probe, or null
 * @param {(cli: object) => boolean} io.supported    resumeSupported
 * @param {(cli: object) => Promise<object>} io.run  runResumeSweep with its default exec (never rejects)
 * @param {(envelope: object) => object} io.read     readResumeSweep
 * @param {() => {resumeAtLaunch: boolean, malformed?: boolean}} io.preference  read when the trigger runs
 * @param {() => void} io.broadcast                  `session-resume:ready` to every live window
 * @param {(line: string) => void} io.log            the preference is off
 * @param {(line: string) => void} io.error          a malformed preference, a failed sweep
 */
export function createResumeAtLaunch({ readCli, supported, run, read, preference, broadcast, log, error }) {
  let started = null, pending = null;
  async function sweep() {
    const cli = await readCli();
    if (!cli || !supported(cli)) return;
    const choice = preference();
    if (choice.malformed) { error("oats-desktop: the session resume preference could not be read; lost sessions are not resumed at this launch"); return; }
    if (choice.resumeAtLaunch !== true) { log("oats-desktop: resuming lost sessions when Desktop opens is turned off"); return; }
    const reading = read(await run(cli));
    if (reading?.kind === "notice") { pending = reading.summary; broadcast(); }
    else if (reading?.kind === "failed") error(`oats-desktop: the session resume sweep failed: ${CODE.test(reading.code) ? reading.code : "E_CLI_PROTOCOL"}`);
  }
  return {
    start() {
      // Nothing thrown is logged as text: the kernel's or the runner's words stay out of the log.
      started ??= sweep().catch(() => error("oats-desktop: the session resume sweep could not be run"));
      return started;
    },
    take() { const summary = pending; pending = null; return summary; },
  };
}

/** The three channels, each behind main's trusted-frame `guard` first. `file()` names the preference file. */
export function installResumeHandlers({ ipc, guard, launch, file, fs = nodeFs }) {
  ipc.handle("session-resume:take", (e) => { guard(e); return launch.take(); });
  ipc.handle("session-resume:preference", (e) => { guard(e); return { resumeAtLaunch: readResumePreference(file(), fs).resumeAtLaunch }; });
  ipc.handle("session-resume:set-preference", (e, value) => { guard(e); return writeResumePreference(file(), value, { fs }); });
}
