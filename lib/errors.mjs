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
/** The two failures the kernel answers under their own names, which are not kernel codes: an OATS
 *  document with an unsafe mapping key, or value. Every command answers them so, and they are the
 *  one exception to the rule above: no door wraps them. */
export const OWN_NAME_FAILURES = new Set(["unsafe-config-key", "unsafe-config-value"]);
/** Whether `code` is one an answer carries as it is: a kernel code, or one of the two names. */
export function isAnswerCode(code) {
  return isKernelCode(code) || OWN_NAME_FAILURES.has(code);
}
/** The code `e` is answered with: its own when an answer carries it (isAnswerCode), else `fallback`. */
export function kernelCode(e, fallback) {
  return isAnswerCode(e?.code) ? e.code : fallback;
}
/** Whether `e` is a defect: something thrown by a mistake in the code, never written as an answer.
 *  It has no code, and it is one of the language's own error kinds, whose `name` is not "Error"
 *  (TypeError, ReferenceError, RangeError, SyntaxError…), or it is a thrown value that is no Error
 *  at all. A plain Error without a code is NOT one: the kernel writes many of its refusals that way,
 *  and a child process that exits non-zero (a tmux or git call) is reported that way too. */
export function isDefect(e) {
  if (typeof e?.code === "string" && e.code) return false;
  return !(e instanceof Error) || e.name !== "Error";
}
/** What an answer's `details.cause` says of an error that is not the kernel's: `{ code, syscall? }`
 *  for one that has a code (the system's, Node's, or one of the kernel's own names that is not a
 *  kernel code), `{ name }` for a defect (isDefect), and undefined for a plain Error without a
 *  code: a refusal has no cause to name, and its answer is the general code and its message alone. */
export function errorCause(e) {
  if (typeof e?.code === "string" && e.code) return { code: e.code, ...(typeof e.syscall === "string" && e.syscall ? { syscall: e.syscall } : {}) };
  if (!isDefect(e)) return undefined;
  return { name: e instanceof Error && typeof e.name === "string" && e.name ? e.name : "Error" };
}
/** `e` as a kernel error. One whose code an answer carries (isAnswerCode) is returned as it is. Any other is wrapped:
 *  the code `fallback`, `message` (default: its own), `details.cause` when it has one (errorCause)
 *  and the error itself as `cause`, so that whoever prints the answer still has a defect's stack. */
export function asKernelError(e, fallback, message) {
  if (isAnswerCode(e?.code)) return e;
  const wrapped = new Error(message ?? String(e?.message ?? e), { cause: e });
  wrapped.code = fallback;
  const cause = errorCause(e);
  if (cause) wrapped.details = { cause };
  return wrapped;
}
/** The defect (isDefect) that `e` is or wraps (asKernelError), else undefined: the one error whose
 *  stack an answer must not swallow. */
export function defectOf(e) {
  const origin = isKernelCode(e?.code) && e.details?.cause && e.cause !== undefined ? e.cause : e;
  return isDefect(origin) ? origin : undefined;
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
