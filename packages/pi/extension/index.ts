/**
 * OATS pi runtime bridge — minimal glue.
 *
 * The kernel materializes every spawned instance's exact set in
 * .agents/skills; this bridge contributes it inside an instance, plus the
 * pre-workspace oats-getting-started bootstrap outside one, and drives the
 * memory session events. Ambient skills coexist with the OATS-composed set.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
 * refuses it when another extension's turn (the @awebai/pi welcome) is
 * running or starts during its preflight. The bridge takes that prompt over
 * and sends it as a followUp, which pi queues behind a running turn. A turn
 * that starts during the prompt's preflight still displaces it; pi 0.85.1
 * then settles the refused prompt while that turn is running. On that
 * evidence only, and once, the bridge sends the task again when the turn is
 * over. Every later prompt is left to pi.
 */
function deliverOpeningTask(pi: ExtensionAPI) {
  type Content = Parameters<ExtensionAPI["sendUserMessage"]>[0];
  let taken = false;
  let runActive = false;
  // Until the task's user message starts: how often it was sent, whether its
  // prompt reached before_agent_start, and whether pi refused it there.
  let opening: { content: Content; sends: number; launching: boolean; refused: boolean } | undefined;

  const send = () => {
    Object.assign(opening!, { sends: opening!.sends + 1, launching: false, refused: false });
    pi.sendUserMessage(opening!.content, { deliverAs: "followUp", expandPromptTemplates: true });
  };

  pi.on("input", (event) => {
    if (taken || event.source !== "interactive" || event.streamingBehavior !== undefined) return { action: "continue" };
    taken = true;
    const content: Content = event.images?.length ? [{ type: "text", text: event.text }, ...event.images] : event.text;
    opening = { content, sends: 0, launching: false, refused: false };
    send();
    return { action: "handled" };
  });
  pi.on("before_agent_start", () => { if (opening) opening.launching = true; });
  pi.on("message_start", (event) => { if (opening && event.message.role === "user") opening = undefined; });
  pi.on("agent_start", () => { runActive = true; });
  pi.on("agent_end", () => { runActive = false; });
  pi.on("agent_settled", () => {
    if (!opening) return;
    if (runActive) {
      if (opening.launching) opening.refused = true;
      return;
    }
    if (!opening.refused) return;
    if (opening.sends < 2) send();
    else opening = undefined;
  });
}
