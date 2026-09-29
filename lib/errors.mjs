/** Kernel error with a stable machine-readable code (contract §4) and optional provenance. */
export function oatsError(code, message, provenance) {
  const e = new Error(message);
  e.code = code;
  if (provenance) e.provenance = provenance;
  return e;
}

/** Herdr was removed in 0.31.0: every place that meets it refuses with E_HERDR_REMOVED, this stem
 *  and what to do. */
export const HERDR_REMOVED = "Herdr is no longer supported by OATS (removed in 0.31.0); tmux is the only session backend.";
/** A flag or configuration value that selects Herdr: `what` names the flag (`--backend herdr was
 *  given`), or the file and key (`<file> sets spawn.backend: herdr`). */
export function herdrSettingRemoved(what) {
  return oatsError("E_HERDR_REMOVED", `${HERDR_REMOVED} ${what}. Remove it (or use tmux).`);
}
/** A session operation on an instance OATS opened in Herdr. */
export function herdrInstanceRemoved(name) {
  return oatsError("E_HERDR_REMOVED", `${HERDR_REMOVED} ${name} was opened in Herdr. Retire it (\`oats retire ${name}\`) and spawn a new instance; it opens in tmux.`);
}
/** Retiring an instance OATS opened in Herdr while processes still work in its home. */
export function herdrInstanceBusy(name, pids) {
  return oatsError("E_HERDR_REMOVED", `${HERDR_REMOVED} ${name} was opened in Herdr. A process still works in this home (pid ${pids.join(", ")}); stop its Herdr pane (for example \`herdr --session oats server stop\`), then retire.`);
}
