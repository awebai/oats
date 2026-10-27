// Lost sessions resumed when Desktop opens: the renderer's side (main's is session-resume-launch.mjs). The shell
// wires both pieces; neither owns a session or runs a command.
//
// The notice: main holds the launch's summary until one window takes it (take-once). A window asks at shell start
// and on each ready event, so one that opens after the sweep still gets it; every answer is posted (a take is a
// handoff that never comes twice, so there is no token to drop it by). The answer is decoded again at this
// boundary (resumeSummaryFact): anything that does not decode, null included, shows nothing, and a rejected take
// is swallowed. resumeNotice words it (packages/client/session-resume.mjs); a deployment is labelled by
// shortPath, its /Users|home/<name> guess, as the renderer has no home directory. It is posted sticky (a
// once-per-launch summary that routine toasts must not evict) and `app` (no workspace's: a switch keeps it), the
// detail behind Details, as text (the center paints textContent only).
//
// The preference (`app.resumeAtLaunch`): main's file is the only copy. read() asks main each time (the settings
// menu at each opening); toggle() reads the current value from main and writes its opposite, one toggle at a
// time; a failed read or write keeps the stored state and says FAILED (non-sticky). The palette's On/Off detail is
// a value read as the palette opens (refresh(), in parallel with its instance load): "" until it lands or when it
// fails; a later refresh or a completed toggle supersedes a read still in flight, and a completed toggle holds the
// value it wrote.
import { resumeSummaryFact, resumeNotice } from "../../client/session-resume.mjs";
import { shortPath } from "../../client/deployment-label.mjs";

export const RESUME_PREFERENCE_ACTION = "app.resumeAtLaunch";
export const RESUME_PREFERENCE_LABEL = "Resume lost sessions when Desktop opens";
export const RESUME_PREFERENCE_FAILED = "The preference could not be saved.";

/** `desk` is window.oatsDesktop (absent: nothing happens); `notify` the notification center's notify. start() takes
 * now and on each ready event; dispose() stops listening (an answer still in flight is then not posted). */
export function createResumeNotice({ desk, notify, label = (path) => shortPath(path) }) {
  let alive = true, off = null;
  const post = (answer) => {
    if (!alive) return;
    const summary = resumeSummaryFact(answer);
    if (!summary) return;
    let notice = null;
    try { notice = resumeNotice(summary, { label }); } catch { return; }
    if (!notice?.headline) return;
    notify(notice.headline, { sticky: true, app: true, ...(notice.detail ? { detail: notice.detail } : {}) });
  };
  const take = () => {
    if (!alive || typeof desk?.takeResumeNotice !== "function") return;
    let answer;
    try { answer = Promise.resolve(desk.takeResumeNotice()); } catch { return; }
    answer.then(post, () => {});
  };
  return {
    start() {
      if (!alive || typeof desk?.takeResumeNotice !== "function") return;
      if (typeof desk.onResumeNoticeReady === "function") off = desk.onResumeNoticeReady(take);
      take();
    },
    dispose() { alive = false; try { off?.(); } catch { /* the bridge is going too */ } off = null; },
  };
}

/** The preference through main. read() → Promise<boolean|null> (null: not readable), never rejecting; toggle()
 * → Promise<void>; refresh() starts the palette's read; detail() → "On" | "Off" | "". */
export function createResumePreference({ desk, notify }) {
  let value = null, serial = 0, chain = Promise.resolve();
  async function read() {
    if (typeof desk?.resumeAtLaunch !== "function") return null;
    try {
      const answer = await desk.resumeAtLaunch();
      return typeof answer?.resumeAtLaunch === "boolean" ? answer.resumeAtLaunch : null;
    } catch { return null; }
  }
  async function write(next) {
    if (typeof desk?.setResumeAtLaunch !== "function") return null;
    try {
      const answer = await desk.setResumeAtLaunch(next);
      if (answer?.ok !== true) return null;
      return typeof answer.resumeAtLaunch === "boolean" ? answer.resumeAtLaunch : next;
    } catch { return null; }
  }
  async function flip() {
    const current = await read();
    const saved = current === null ? null : await write(!current);
    if (saved === null) { notify(RESUME_PREFERENCE_FAILED); return; }
    serial++; value = saved; // supersedes a palette read sent before the write landed
  }
  return {
    read,
    toggle() { chain = chain.then(flip, flip); return chain; },
    refresh() {
      const token = ++serial; value = null;
      void read().then((on) => { if (token === serial) value = on; });
    },
    detail: () => (value === true ? "On" : value === false ? "Off" : ""),
  };
}
