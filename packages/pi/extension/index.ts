/**
 * OATS pi runtime bridge — minimal glue.
 *
 * The kernel materializes every spawned instance's exact set in
 * .agents/skills; this bridge contributes it inside an instance, plus the
 * pre-workspace oats-getting-started bootstrap outside one, and drives the
 * memory session events. Ambient skills coexist with the OATS-composed set.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendLogEntry, PACKAGED_SKILLS_DIR } from "./core-loader.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export default function (pi: ExtensionAPI) {
  const agentHome = process.env.OATS_INSTANCE_HOME;
  const isInstance = !!agentHome && existsSync(join(agentHome, "instance.json"));

  pi.on("resources_discover", async () => {
    if (isInstance) {
      const local = join(agentHome!, ".agents", "skills");
      return existsSync(local) ? { skillPaths: [local] } : undefined;
    }
    const gettingStarted = join(PACKAGED_SKILLS_DIR, "oats-getting-started");
    return existsSync(gettingStarted) ? { skillPaths: [gettingStarted] } : undefined;
  });

  if (isInstance) {
    deliverOpeningTask(pi);

    pi.on("session_compact", async (event) => {
      if (!existsSync(join(agentHome!, "STATE.md"))) return;
      try {
        const summary = (event.compactionEntry?.summary ?? "").replace(/\s+/g, " ").trim();
        appendLogEntry(
          join(agentHome!, "log.md"),
          `**Compaction** (${event.reason}): ${summary.slice(0, 400)}${summary.length > 400 ? "…" : ""}`,
          "Instance Log",
        );
      } catch { /* memory automation must never break a session */ }
      pi.sendMessage({
        customType: "oats-memory",
        content: "Context was just compacted. Before continuing, update ./STATE.md (Plan/Progress/Next) so a fresh session could resume from files alone.",
        display: false,
      }, { deliverAs: "steer" });
    });

    pi.on("session_start", async (event) => {
      if (event.reason !== "startup" && event.reason !== "resume" && event.reason !== "new") return;
      const statePath = join(agentHome!, "STATE.md");
      if (!existsSync(statePath)) return;
      const state = readFileSync(statePath, "utf8");
      const touched = !/_No task assigned yet/.test(state) || !/_\(the single next action/.test(state);
      if (event.reason === "startup" && !touched) return;
      pi.sendMessage({
        customType: "oats-memory",
        content: `You are agent instance home ${agentHome}. Read ./STATE.md and the recent entries of ./log.md now, then continue from STATE.md's "Next" section. Keep STATE.md current as you work.`,
        display: false,
      }, { deliverAs: "steer", triggerTurn: false });
    });
  }
}

/**
 * The opening task reaches the transcript exactly once. pi sends the launch's
 * `@TASK.md` as the session's first prompt with no streamingBehavior, and
 * refuses it when another extension's run (the @awebai/pi welcome) holds the
 * agent. The prompt stays on pi's own path, so input processing applies once:
 * the bridge holds it in its input handler, and again in before_agent_start
 * (a run can start during its preflight), until no run is active. A run that
 * starts after the bridge's before_agent_start handler still makes pi refuse
 * it; pi 0.85.1 then settles the refused prompt while that run holds the
 * agent. On that evidence only, and once, the bridge sends the prompt as pi
 * built it again, as a followUp, when that run has settled. Every later
 * prompt is left to pi.
 */
function deliverOpeningTask(pi: ExtensionAPI) {
  type Content = Parameters<ExtensionAPI["sendUserMessage"]>[0];
  let taken = false;
  // Until the task's user message starts: whether its prompt reached
  // before_agent_start and what pi built, whether pi refused it, and whether
  // it was sent again.
  let opening: { launching: boolean; content?: Content; refused: boolean; resent: boolean } | undefined;
  const settleWaiters: (() => void)[] = [];
  // pi refuses a prompt while pi-agent-core holds a run (ctx.signal is that
  // run's), and one with no streamingBehavior while the session is not idle.
  const busy = (ctx: ExtensionContext) => ctx.signal !== undefined || !ctx.isIdle();
  const untilFree = async (ctx: ExtensionContext) => {
    while (busy(ctx)) await new Promise<void>((resolve) => settleWaiters.push(resolve));
  };

  pi.on("input", async (event, ctx) => {
    if (taken || event.source !== "interactive" || event.streamingBehavior !== undefined) return { action: "continue" };
    taken = true;
    opening = { launching: false, refused: false, resent: false };
    await untilFree(ctx);
    return { action: "continue" };
  });
  pi.on("before_agent_start", async (event, ctx) => {
    if (!opening || opening.launching) return;
    opening.launching = true;
    opening.content = event.images?.length ? [{ type: "text", text: event.prompt }, ...event.images] : event.prompt;
    await untilFree(ctx);
  });
  pi.on("message_start", (event) => { if (opening && event.message.role === "user") opening = undefined; });
  pi.on("agent_settled", (_event, ctx) => {
    if (opening?.launching) {
      if (ctx.signal !== undefined) opening.refused = true;
      else if (opening.refused && opening.resent) opening = undefined;
      else if (opening.refused) {
        Object.assign(opening, { launching: false, refused: false, resent: true });
        pi.sendUserMessage(opening.content!, { deliverAs: "followUp" });
      }
    }
    for (const wake of settleWaiters.splice(0)) wake();
  });
}
