// What the bridge must do in each opening-task scenario, asserted the same
// way whether the scenario ran in a PiHost or in pi itself. Every assertion is
// about the bridge: the task's user message enters the transcript once, with
// its content as input processing made it once, after a welcome that ran
// first; and what the bridge sent pi itself.
import assert from "node:assert/strict";

const users = (result) => result.transcript.filter((m) => m.role === "user").map((m) => m.text);
const at = (result, text) => result.transcript.findIndex((m) => m.text === text);

export const SCENARIOS = [
  { name: "no-race", title: "no race: the task is the first message, delivered once", task: "THE TASK", first: true },
  { name: "welcome-first", title: "welcome first: the task runs after the running welcome turn", task: "THE TASK", afterWelcome: true },
  { name: "welcome-in-preflight", title: "task first, welcome during its preflight: the task runs after the welcome", task: "THE TASK", afterWelcome: true },
  { name: "welcome-in-preflight-slow-agent-start", title: "the same, with an extension ahead of the bridge awaiting in agent_start", task: "THE TASK", afterWelcome: true },
  { name: "welcome-in-before-agent-start-ahead", title: "welcome during before_agent_start, ahead of the bridge: the task runs after it", task: "THE TASK", afterWelcome: true },
  { name: "welcome-in-before-agent-start-behind", title: "welcome during before_agent_start, behind the bridge: the refused task is sent again, once", task: "THE TASK", afterWelcome: true, resent: true },
  { name: "welcome-after-task-started", title: "task started, then the welcome: nothing is sent again", task: "THE TASK", afterWelcome: false },
  { name: "displaced-twice", title: "the task is sent again at most once", task: null, resent: true },
  { name: "input-transform", title: "an input transformer ahead of the bridge applies once", task: "PREFIX THE TASK", first: true, inputOnce: true },
  { name: "input-transform-welcome-first", title: "an input transformer ahead of the bridge applies once when the task waits for the welcome", task: "PREFIX THE TASK", afterWelcome: true, inputOnce: true },
];

export function assertScenario(result, scenario) {
  const why = JSON.stringify(result);
  assert.deepEqual(users(result), scenario.task ? [scenario.task] : [], why);
  if (scenario.first) assert.deepEqual(result.transcript.map((m) => m.role), ["user", "assistant"], why);
  if (scenario.afterWelcome === true) assert.ok(at(result, scenario.task) > at(result, "WELCOME") && at(result, "WELCOME") >= 0, `the task runs after the welcome: ${why}`);
  if (scenario.afterWelcome === false) assert.ok(at(result, scenario.task) < at(result, "WELCOME"), `the task runs before the welcome: ${why}`);
  // The bridge sends a user message of its own only to resend a refused task, once.
  assert.deepEqual(result.bridgeSent, scenario.resent ? ["THE TASK"] : [], why);
  // Input processing ran once, on pi's own path.
  if (scenario.inputOnce) assert.deepEqual(result.inputSources, ["interactive"], why);
}
