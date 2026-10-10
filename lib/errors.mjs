/** Kernel error with a stable machine-readable code (contract §4) and optional provenance. */
export function oatsError(code, message, provenance) {
  const e = new Error(message);
  e.code = code;
  if (provenance) e.provenance = provenance;
  return e;
}

/** Whether `code` has the shape of a kernel code (`E_` and upper-case letters, digits and
 *  underscores): the only codes an answer of the kernel carries. It tests the shape, not a list of
 *  known codes, and that is enough: the kernel has no dependency, and neither the system (`ENOENT`)
 *  nor Node (`ERR_…`) gives a code of that shape. An allow-list on purpose: what is not a kernel
 *  code is wrapped (asKernelError), whatever it is, so the next unknown code does not pass. */
export function isKernelCode(code) {
  return typeof code === "string" && /^E_[A-Z0-9_]+$/.test(code);
}
/** The code `e` is answered with: its own when it is a kernel code, else `fallback`. */
export function kernelCode(e, fallback) {
  return isKernelCode(e?.code) ? e.code : fallback;
}
/** What an answer's `details.cause` says of an error that is not the kernel's: `{ code, syscall? }`
 *  for one that has a code (the system's, or Node's), `{ name }` for an exception without one. */
export function errorCause(e) {
  if (typeof e?.code === "string" && e.code) return { code: e.code, ...(typeof e.syscall === "string" && e.syscall ? { syscall: e.syscall } : {}) };
  return { name: typeof e?.name === "string" && e.name ? e.name : "Error" };
}
/** `e` as a kernel error. One that has a kernel code is returned as it is. Any other is wrapped:
 *  the code `fallback`, `message` (default: its own), `details.cause` (errorCause) and the error
 *  itself as `cause`, so that whoever prints the answer still has its stack. */
export function asKernelError(e, fallback, message) {
  if (isKernelCode(e?.code)) return e;
  const wrapped = new Error(message ?? String(e?.message ?? e), { cause: e });
  wrapped.code = fallback;
  wrapped.details = { cause: errorCause(e) };
  return wrapped;
}
/** The exception without a code (a defect) that `e` is or wraps (asKernelError), else undefined:
 *  the one error whose stack an answer must not swallow. */
export function defectOf(e) {
  const origin = isKernelCode(e?.code) && e.details?.cause && e.cause !== undefined ? e.cause : e;
  return origin instanceof Error && !(typeof origin.code === "string" && origin.code) ? origin : undefined;
}

/** Print on stderr the stack of the defect `e` is or wraps (defectOf), when there is one. For
 *  whoever ends an error's way up: the door that answers it, and a caller that turns it into data
 *  (a row of a stop's results), after which nobody else can print it. */
export function reportDefect(e) {
  const defect = defectOf(e);
  if (defect) process.stderr.write(`${defect.stack || String(defect)}\n`);
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
