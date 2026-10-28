/** The word `oats status` and `oats status --server <id>` print for an instance row in text, and
 *  the way back they print under a row whose session was lost (#1617). Rows in, strings out: the
 *  row is a `status --json` instance row, this kernel's or a host's, read as it is. A host on a
 *  kernel before `sessionEnd` (feature session-resume) sends none, and its rows read `idle` as
 *  before. The JSON is never changed here. Dependency-free. */
import { terminalText } from "./refused-text.mjs";
import { shellWord } from "./shell-word.mjs";
import { SESSION_END } from "./session-resume-contract.mjs";

const isLost = (i) => i.running === false && i.sessionEnd === SESSION_END.LOST;

/** `running` true is RUNNING; false is LOST when the session was lost (`sessionEnd: "lost"`, the
 *  judgement the resume sweep acts on), else idle (stopped, exited, never launched, or not said);
 *  null (a server that cannot be read, a Herdr home) is unknown, never idle. */
export const livenessWord = (i) => i.running === true ? "RUNNING" : i.running === false ? (isLost(i) ? "LOST" : "idle") : "unknown";

/** A row's word: a retire under way wins over its liveness. */
export const statusWord = (i) => i.retirePending ? "RETIRING" : livenessWord(i);

/** The one line under a LOST row that says how to bring it back, or null for any other row. Local:
 *  the resume by hand, or the next sweep. `host` (a `--server` row): both refuse `--server`
 *  (E_BAD_ARGS), so the line says to run them on that host. */
export function lostLine(i, { host } = {}) {
  if (i.retirePending || !isLost(i)) return null;
  const start = typeof i.home === "string" && i.home ? `oats session start --resume --home ${shellWord(i.home)}` : null;
  if (host !== undefined) return terminalText(`lost: on ${host}, run ${start ? `${start} there, or its next oats session resume` : "oats session resume there"}`);
  const sweep = "the next oats session resume (run when OATS Desktop or oats tui opens)";
  return terminalText(start ? `lost: ${start} brings it back; so does ${sweep} if it can vouch for the loss` : `lost: ${sweep} brings it back if it can vouch for the loss`);
}
