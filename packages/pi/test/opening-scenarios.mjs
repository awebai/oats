// What the bridge must do in each opening-task scenario, asserted the same
// way whether the scenario ran in a PiHost or in pi itself. Every assertion is
// about the bridge: the task's user message enters the transcript once, with
// its content as input processing made it once, after a welcome that ran
// first; the bridge never sends a message of its own. The exception (a turn
// started behind the bridge inside its own handling of the opening prompt)
// is pinned too: pi refuses the task, which is never duplicated or altered.
// pi 1.2 and later count a run as active from before its before_agent_start
// and queue a message sent meanwhile into that run, after its own message:
// `startsRunFirst` holds what then differs, the welcome sent while the task's
// run starts running after the task, never refusing it.
import assert from "node:assert/strict";

const users = (result) => result.transcript.filter((m) => m.role === "user").map((m) => m.text);
const at = (result, text) => result.transcript.findIndex((m) => m.text === text);

export const SCENARIOS = [
  { name: "no-race", title: "no race: a default SDK prompt is the first message, delivered once", task: "THE TASK", first: true },
  { name: "interactive-opening", title: "the opening task as interactive mode sends it runs once", task: "THE TASK", first: true },
  { name: "extension-prompt-first", title: "an extension's prompt is not the opening task: the task runs once, after it", task: "THE TASK", users: ["EXTENSION PROMPT", "THE TASK"] },
  { name: "abort-while-held", title: "an abort while the task waits for the welcome settles; the task then runs once, after it", task: "THE TASK", afterWelcome: true, abortSettled: true },
  { name: "abort-during-start", title: "an abort while the task's run starts settles, and so does the prompt; the task is delivered once", task: "THE TASK", abortSettled: true },
  { name: "welcome-first", title: "welcome first: the task runs after the running welcome turn", task: "THE TASK", afterWelcome: true },
  { name: "welcome-first-without-agent-settled", title: "welcome first on a pi without agent_settled: the task runs after the welcome", task: "THE TASK", afterWelcome: true, hostOnly: true, beforeAgentSettled: true },
  { name: "welcome-first-without-agent-settled-slow-agent-end", title: "the same, with an extension behind the bridge awaiting in agent_end", task: "THE TASK", afterWelcome: true, hostOnly: true, beforeAgentSettled: true },
  { name: "shutdown-while-held", title: "a session that shuts down while the task waits releases the hold: pi refuses the task, and the prompt settles", refused: true, hostOnly: true },
  { name: "welcome-in-preflight", title: "task first, welcome during its preflight: the task runs after the welcome", task: "THE TASK", afterWelcome: true, startsRunFirst: { afterWelcome: false, title: "task first, welcome during its preflight: pi queues the welcome into the task's run, after the task" } },
  { name: "welcome-in-preflight-slow-agent-start", title: "the same, with an extension ahead of the bridge awaiting in agent_start", task: "THE TASK", afterWelcome: true, startsRunFirst: { afterWelcome: false, title: "the same, with an extension ahead of the bridge awaiting in agent_start: the welcome runs after the task" } },
  { name: "welcome-in-before-agent-start-ahead", title: "welcome during before_agent_start, ahead of the bridge: the task runs after it", task: "THE TASK", afterWelcome: true, startsRunFirst: { afterWelcome: false, title: "welcome during before_agent_start, ahead of the bridge: pi queues it into the task's run, after the task" } },
  { name: "welcome-after-task-started", title: "task started, then the welcome: the task runs first", task: "THE TASK", afterWelcome: false },
  { name: "input-transform", title: "an input transformer ahead of the bridge applies once", task: "PREFIX THE TASK", first: true, inputOnce: true },
  { name: "input-transform-welcome-first", title: "an input transformer ahead of the bridge applies once when the task waits for the welcome", task: "PREFIX THE TASK", afterWelcome: true, inputOnce: true },
  // The exception.
  { name: "welcome-in-input-behind", title: "exception: a welcome started in an input handler behind the bridge makes pi refuse the task, never duplicated or altered", refused: true },
  { name: "welcome-in-before-agent-start-behind", title: "exception: a welcome started in before_agent_start behind the bridge makes pi refuse the task, never duplicated or altered", refused: true, startsRunFirst: { refused: false, task: "THE TASK", afterWelcome: false, title: "a welcome started in before_agent_start behind the bridge: pi queues it into the task's run, after the task" } },
  { name: "input-transform-welcome-in-before-agent-start-behind", title: "exception: with an input transformer ahead of the bridge, the refused task is never altered", refused: true, inputOnce: true, startsRunFirst: { refused: false, task: "PREFIX THE TASK", afterWelcome: false, title: "the same with an input transformer ahead of the bridge: the task runs once, transformed once, before the welcome" } },
];

/** What `scenario` expects of a pi that counts a run as active from before its before_agent_start (1.2 and later), or of an earlier one. */
export function expected(scenario, startsRunFirst) {
  return startsRunFirst ? { ...scenario, ...scenario.startsRunFirst } : scenario;
}

export function assertScenario(result, scenario) {
  const why = JSON.stringify(result);
  if (scenario.abortSettled) assert.equal(result.abortSettled, true, `the abort settled: ${why}`);
  assert.deepEqual(result.bridgeSent, [], `the bridge sends nothing: ${why}`);
  if (scenario.inputOnce) assert.deepEqual(result.inputSources, ["interactive"], `input processing ran once, on pi's own path: ${why}`);
  if (scenario.refused) {
    assert.notEqual(result.promptError, null, why);
    assert.deepEqual(users(result), [], `the refused task is neither duplicated nor altered: ${why}`);
    return;
  }
  assert.equal(result.promptError, null, why);
  assert.deepEqual(users(result), scenario.users ?? [scenario.task], why);
  if (scenario.first) assert.deepEqual(result.transcript.map((m) => m.role), ["user", "assistant"], why);
  if (scenario.afterWelcome === true) assert.ok(at(result, "WELCOME") >= 0 && at(result, scenario.task) > at(result, "WELCOME"), `the task runs after the welcome: ${why}`);
  if (scenario.afterWelcome === false) assert.ok(at(result, scenario.task) < at(result, "WELCOME"), `the task runs before the welcome: ${why}`);
}
