/** Move to background / Move out of background (feature instance-background, awebai/oats#1579): the row context
 * menu's items (instance-actions.mjs draws them among the caller's own) and what running one does. The write is the
 * backend's (POST /api/instance-background, server/instance-background.mjs over `oats instance background`); the
 * server re-reads the roster after a change or an unknown outcome, and the sidebar's Background section follows that
 * read. Nothing here edits a row or moves one.
 *
 * Which item a row offers: Move out of background on a row whose own `background` is true; Move to background on
 * any other row, except one that is in the Background section only through an ancestor (instance-tree.mjs
 * backgroundPlacement): its flag is not what placed it, so it offers neither (move the parent).
 *
 * The gate is the route's own (`{ check: true }`, which runs nothing): this computer's CLI lists the feature and,
 * for a remote row, so does its host. The menu is drawn synchronously on every roster paint, so the answer is
 * held per deployment (a deployment is one machine, so one host's features) and asked again once it is older than
 * `ttlMs`, the held one staying in force meanwhile. Until a deployment's first answer, and where the feature is
 * missing, the items are not drawn (an older OATS shows no item, as it shows no section); a held answer that
 * changes calls `onGate()`, for the caller to repaint. */
import { backgroundPlacement, instanceId } from "../../client/instance-tree.mjs";
import { canAddressRemote, serverLabel, shownLabel } from "../../client/remote-address.mjs";
import { displayLine, DETAIL_WITHHELD } from "../../client/display-text.mjs";
import { kernelLines } from "../../client/kernel-lines.mjs";
import { DESKTOP_TERMS } from "./desktop-terms.mjs";

/** The menu's words for each item (an act at once: no dialog follows, so no ellipsis). */
export const BACKGROUND_LABELS = Object.freeze({ "background-on": "Move to background", "background-off": "Move out of background" });
export const BACKGROUND_UNAVAILABLE = "E_INSTANCE_BACKGROUND_UNAVAILABLE";
const HELD_MS = 60_000;

/** The item a row offers, or null. `placed`: backgroundPlacement's set for the rows it is drawn with. */
export function backgroundOffer(instance, placed) {
  if (instance?.background === true) return "background-off";
  return placed?.has(instanceId(instance)) ? null : "background-on";
}

/** Why an answer to a write is not a success, as the menu's report detail; null when it is one (or the outcome is not
 * known: the roster re-read says what is true). */
export function backgroundFailure(answer, row, background) {
  if (answer?.status === "ok" && answer.check !== true && answer.instance === row.instance && answer.background === background) return null;
  if (answer?.status === "unknown") return null;
  const reason = answer?.reason;
  if (answer?.status === "refused" && typeof reason?.code === "string") return kernelLines(reason.message, undefined, DESKTOP_TERMS).join("\n") || reason.code;
  if (answer?.status === "not-run" && reason?.code === BACKGROUND_UNAVAILABLE) {
    return reason.details?.where === "server" ? `${shownLabel(serverLabel(row), true)}'s OATS can't move instances to the background yet.`
      : "Moving an instance to the background needs a newer OATS on this computer.";
  }
  const line = displayLine(reason?.message);
  return line && line !== DETAIL_WITHHELD ? line : "The answer was not one this Desktop reads.";
}

/**
 * @param {object} deps
 * @param {(row, body) => Promise<object>} deps.request  POST /api/instance-background for the row's deployment → its answer
 * @param {(row) => string} deps.deploymentOf  the row's deployment id (the route's ?ws=)
 * @param {() => void} [deps.onGate]  a deployment's held answer changed: repaint
 */
export function createInstanceBackgroundMenu({ request, deploymentOf, onGate = () => {}, now = () => Date.now(), ttlMs = HELD_MS }) {
  const gates = new Map(); // deployment id -> { enabled: boolean|null, at, flight }
  const placements = new WeakMap(); // the rows array a paint draws with -> its placement (one walk per paint)
  /** Whether the row's deployment offers the items: true, false, or null (not known yet; a check was started). */
  function gate(row) {
    let key;
    try { key = deploymentOf(row); } catch { return null; }
    if (typeof key !== "string" || !key) return null;
    const held = gates.get(key) ?? { enabled: null, at: -Infinity, flight: null };
    gates.set(key, held);
    // Only a row the route can admit asks (a remote row its host reports addressable); its answer is the deployment's.
    if (!held.flight && now() - held.at >= ttlMs && typeof row?.home === "string" && canAddressRemote(row)) {
      const flight = held.flight = Promise.resolve().then(() => request(row, { instance: row.instance, home: row.home, check: true })).then(answer => {
        const enabled = answer?.status === "ok" && answer.check === true ? true
          : answer?.status === "not-run" && answer.reason?.code === BACKGROUND_UNAVAILABLE ? false : held.enabled;
        return enabled;
      }, () => held.enabled).then(enabled => {
        if (held.flight !== flight) return;
        held.flight = null; held.at = now();
        if (enabled !== held.enabled) { held.enabled = enabled; try { onGate(); } catch { /* a repaint must not break the gate */ } }
      });
    }
    return held.enabled;
  }
  return {
    gate,
    /** The menu's item for `row`, as instance-actions.mjs `extra` descriptors: none or one. `placed`: the paint's
     * backgroundPlacement set (the sidebar's own), or the rows it paints, whose placement is then walked once. */
    items(row, placed) {
      if (gate(row) !== true) return [];
      if (!(placed instanceof Set)) {
        const rows = Array.isArray(placed) ? placed : [];
        placed = placements.get(rows) ?? backgroundPlacement(rows, true);
        placements.set(rows, placed);
      }
      const action = backgroundOffer(row, placed);
      return action ? [{ action, label: BACKGROUND_LABELS[action] }] : [];
    },
    handles: action => Object.hasOwn(BACKGROUND_LABELS, action),
    /** Run the item: resolves with the answer on a success or an unknown outcome; throws with why on any other
     * (the menu's `report`: "<label> didn't finish for <name>.", the why as its detail). */
    async run(action, row) {
      if (!Object.hasOwn(BACKGROUND_LABELS, action)) throw new Error(`Unknown instance action "${action}"`);
      const background = action === "background-on";
      const answer = await request(row, { instance: row.instance, home: row.home, background });
      const why = backgroundFailure(answer, row, background);
      if (why !== null) {
        // The feature is gone where it was held (a CLI or host changed): the items go with the next paint.
        if (answer?.status === "not-run" && answer.reason?.code === BACKGROUND_UNAVAILABLE) {
          const held = gates.get(deploymentOf(row));
          if (held && held.enabled !== false) { held.enabled = false; held.at = now(); try { onGate(); } catch { /* as above */ } }
        }
        throw new Error(why);
      }
      return answer;
    },
  };
}
