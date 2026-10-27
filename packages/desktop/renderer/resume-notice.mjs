// Lost sessions resumed: the renderer's side (main's is session-resume-launch.mjs, which wires the shared trigger,
// packages/client/session-resume-trigger.mjs). The shell wires it; it owns no session and runs no command.
//
// Main queues each sweep's summary (at most RESUME_NOTICE_TAKE, the oldest first) until a window takes them all
// (take-and-clear). A window takes at shell start and on each ready event, so one that opens after a sweep still
// gets them; every answer is posted (a take is a handoff that never comes twice, so there is no token to drop it
// by). The answer must be an array: anything else, null included, shows nothing, and a rejected take is swallowed.
// At most RESUME_NOTICE_TAKE elements are read (main's cap: more is not main's answer), each decoded again at this
// boundary (resumeSummaryFact); one that does not decode is skipped and the others still post. resumeNotice words
// each (packages/client/session-resume.mjs); a deployment is labelled by shortPath, its /Users|home/<name> guess, as
// the renderer has no home directory. Each summary is its own notice, posted in the queue's order: sticky (routine
// toasts must not evict it), `app` (no workspace's: a switch keeps it) and in the `session-resume` group (more than
// 3 collapse into one "N notices about resumed sessions" entry), the detail behind Details, as text (the center
// paints textContent only).
import { resumeSummaryFact, resumeNotice } from "../../client/session-resume.mjs";
import { shortPath } from "../../client/deployment-label.mjs";

export const RESUME_NOTICE_TAKE = 10;
export const RESUME_NOTICE_GROUP = "session-resume";
const groupLabel = (n) => `${n} notices about resumed sessions`;

/** `desk` is window.oatsDesktop (absent: nothing happens); `notify` the notification center's notify. start() takes
 * now and on each ready event; dispose() stops listening (an answer still in flight is then not posted). */
export function createResumeNotice({ desk, notify, label = (path) => shortPath(path) }) {
  let alive = true, off = null;
  const postOne = (element) => {
    const summary = resumeSummaryFact(element);
    if (!summary) return;
    let notice = null;
    try { notice = resumeNotice(summary, { label }); } catch { return; }
    if (!notice?.headline) return;
    notify(notice.headline, { sticky: true, app: true, group: RESUME_NOTICE_GROUP, groupLabel,
      ...(notice.detail ? { detail: notice.detail } : {}) });
  };
  const post = (answer) => {
    if (!alive || !Array.isArray(answer)) return;
    for (let i = 0; i < Math.min(answer.length, RESUME_NOTICE_TAKE) && alive; i++) postOne(answer[i]);
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
