/** The waiting row over a terminal pane (#1502): while the pane's instance has a live `waitingOnYou` claim,
 * the row above its terminal says so in words. Its head is the list's `Needs input` tag and the age
 * (" · 12 min"), on one line that never wraps; under it the agent's message, as text (agent text is never
 * markup), wrapped to at most WAITING_LINES lines, cut with "…". The whole row stays within a quarter of the
 * pane: the message gives up lines first, and a pane too short for even the head shows no row (the tab's
 * own mark still says Needs input).
 * A null message reads the reason in words (waitingLabel).
 *
 * The terminal gives the row its rows, so the row's height is the terminal's: it changes only when the
 * claim starts, clears or its shown text changes. The age ticks inside the head's one line, so a tick
 * never moves the message or resizes the terminal; nothing here runs on a timer. The clamp follows the
 * pane's own height (a layout change, never a tick), through one observation of the pane for the row's
 * life. Pure DOM, no shell state: syncTabNeedsInput (shell.mjs) calls it with the claim the gate passed. */
import { iconElement } from "./shell-icons.mjs";
import { waitingLabel, waitedText } from "../../client/waiting-on-you.mjs";

/** The most lines the message wraps to. */
export const WAITING_LINES = 3;

/** What fits in a quarter of the `pane`'s height: the row when its `chrome` (padding, border and head) does,
 * and up to WAITING_LINES message lines of height `line` beside it (0: the head alone). `null` when the pane,
 * the line or the chrome is not measured (a hidden pane or row): the row keeps what it had. */
export function waitingFit({ pane, chrome, line }) {
  if (!(pane > 0) || !(line > 0) || !(chrome > 0)) return null;
  const room = pane / 4 - chrome;
  return { row: room >= 0, lines: room >= 0 ? Math.min(WAITING_LINES, Math.floor(room / line)) : 0 };
}

const chromes = new WeakMap(); // row -> its last measured chrome, for when it is hidden and measures nothing

/** Shows the row and its message lines that fit in its pane now (waitingFit); a row that does not fit is
 * hidden, and the terminal keeps the whole pane. */
export function fitWaitingLines(row) {
  const pane = row.parentElement, message = row.querySelector(":scope > .waiting-message");
  if (!pane || !message) return;
  if (!row.hidden && row.offsetHeight > 0) chromes.set(row, row.offsetHeight - message.offsetHeight);
  const line = Number.parseFloat(row.ownerDocument.defaultView.getComputedStyle(message).lineHeight);
  const fit = waitingFit({ pane: pane.clientHeight, chrome: chromes.get(row), line });
  if (!fit) return;
  if (row.hidden !== !fit.row) row.hidden = !fit.row;
  if (message.hidden !== (fit.lines === 0)) message.hidden = fit.lines === 0;
  if (fit.lines && row.style.getPropertyValue("--waiting-lines") !== String(fit.lines)) row.style.setProperty("--waiting-lines", String(fit.lines));
}

const disconnects = new WeakMap(); // row -> the end of its pane's observation
const observePane = (pane, fn) => {
  if (typeof ResizeObserver !== "function") return () => {};
  const observer = new ResizeObserver(fn); observer.observe(pane);
  return () => observer.disconnect();
};

/** Shows `claim` (a waitingClaim, or null) on `pane`'s waiting row at `now`: makes the row before the
 * terminal when a claim starts, removes it when it clears, and otherwise writes only what changed, so an age
 * tick rewrites the age alone. `observe(pane, fn)` watches the pane's size (a ResizeObserver by default). */
export function syncWaitingRow(pane, claim, now = Date.now(), { observe = observePane } = {}) {
  let row = pane.querySelector(":scope > .waiting-row");
  if (!claim) {
    if (row) { disconnects.get(row)?.(); disconnects.delete(row); row.remove(); }
    return;
  }
  if (!row) {
    const doc = pane.ownerDocument;
    row = doc.createElement("div"); row.className = "waiting-row";
    const head = doc.createElement("div"); head.className = "waiting-head";
    const tag = doc.createElement("span"); tag.className = "ctx-attn";
    tag.append(iconElement(doc, "alert", { size: 11 }), "Needs input");
    const age = doc.createElement("span"); age.className = "waiting-age";
    head.append(tag, age);
    const message = doc.createElement("p"); message.className = "waiting-message"; message.dir = "auto";
    row.append(head, message);
    pane.prepend(row);
    disconnects.set(row, observe(pane, () => fitWaitingLines(row)));
  }
  const age = row.querySelector(".waiting-age"), message = row.querySelector(".waiting-message");
  const aged = ` · ${waitedText(claim.since, now)}`;
  if (age.textContent !== aged) age.textContent = aged;
  const text = claim.message ?? waitingLabel(claim);
  if (message.textContent !== text) message.textContent = text;
  if (message.classList.contains("reason") !== (claim.message == null)) message.classList.toggle("reason", claim.message == null);
}
