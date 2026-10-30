/**
 * failed-turn.mjs — a turn that ends in a provider error stops the instance with
 * nothing left to run an instruction, so the bridge says so itself
 * (awebai/oats#1667): a waiting claim through the kernel's verb, as oats.core
 * does for Claude Code.
 *
 * agent_end is too early: pi retries a transient error and recovers an overflow
 * after it, and each attempt has its own agent_end. Only agent_settled (pi 0.80.4
 * and later) says pi will not go on, and a pi without it reports nothing. The last
 * run decides: a retry that worked leaves nothing to report, and an abort is not an
 * error. The next run clears the claim. This process cannot know what an earlier pi
 * in the session claimed (a /reload, a pi started again in the pane), so its first run
 * clears too; after that, a run with no claim to clear starts no process.
 */
import { execFile } from "node:child_process";
import { join } from "node:path";

/** The characters the kernel refuses in a claim's message: a copy of its set
 *  (lib/refused-text.mjs REFUSED_TEXT), which this package cannot import before it
 *  has found the kernel. A claim the kernel refuses is a stuck instance nobody
 *  sees. A test pins the two equal. */
export const MESSAGE_REFUSED = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF\u{E0000}-\u{E007F}]/gu;
/** The kernel's longest message, in code points (lib/instance-events.mjs WAITING_MESSAGE_MAX). */
const MESSAGE_MAX = 200;

/** The claim's message for a run's error: one the kernel accepts, whatever the provider said. */
export function failedTurnMessage(error) {
  const said = typeof error === "string" ? error.replace(/\s+/gu, " ").trim().replace(MESSAGE_REFUSED, "\ufffd") : "";
  const points = [...(said ? `Turn failed: ${said}` : "Turn failed")];
  return points.length > MESSAGE_MAX ? `${points.slice(0, MESSAGE_MAX - 1).join("")}…` : points.join("");
}

/** Writes run one at a time, so a clear cannot pass the set it answers. A failed
 *  write is dropped: reporting must never break a session. */
export function reportFailedTurn(pi, home) {
  let failure;
  let claimed = true;
  let writes = Promise.resolve();
  const waiting = (...args) => {
    const argv = ["instance", "waiting", ...args, "--producer", "oats.pi", "--home", home, "--json"];
    writes = writes.then(() => new Promise((done) => {
      execFile(join(home, ".oats", "bin", "oats"), argv, { cwd: home, timeout: 5000 }, () => done());
    }));
  };
  pi.on("agent_start", () => {
    failure = undefined;
    if (!claimed) return;
    claimed = false;
    waiting("clear");
  });
  pi.on("agent_end", (event) => {
    const last = event.messages.findLast((message) => message.role === "assistant");
    failure = last?.stopReason === "error" ? failedTurnMessage(last.errorMessage) : undefined;
  });
  pi.on("agent_settled", () => {
    if (failure === undefined) return;
    claimed = true;
    waiting("set", "--reason", "attention", `--message=${failure}`);
    failure = undefined;
  });
}
