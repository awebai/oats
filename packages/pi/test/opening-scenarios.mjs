// What the bridge must do in each opening-task scenario, asserted the same
// way whether the scenario ran in a PiHost or in pi itself. Every assertion is
// about the bridge: the task's user message enters the transcript once, with
// its content as input processing made it once, after a welcome that ran
// first; the bridge never sends a message of its own. The exception (a turn
// started behind the bridge inside its own handling of the opening prompt)
// is pinned too: pi refuses the task, which is never duplicated or altered.
import assert from "node:assert/strict";

const users = (result) => result.transcript.filter((m) => m.role === "user").map((m) => m.text);
const at = (result, text) => result.transcript.findIndex((m) => m.text === text);

export const SCENARIOS = [
  { name: "no-race", title: "no race: the task is the first message, delivered once", task: "THE TASK", first: true },
  { name: "welcome-first", title: "welcome first: the task runs after the running welcome turn", task: "THE TASK", afterWelcome: true },
  { name: "welcome-first-without-agent-settled", title: "welcome first on a pi without agent_settled: the task runs after the welcome", task: "THE TASK", afterWelcome: true, hostOnly: true },
  { name: "welcome-in-preflight", title: "task first, welcome during its preflight: the task runs after the welcome", task: "THE TASK", afterWelcome: true },
  { name: "welcome-in-preflight-slow-agent-start", title: "the same, with an extension ahead of the bridge awaiting in agent_start", task: "THE TASK", afterWelcome: true },
  { name: "welcome-in-before-agent-start-ahead", title: "welcome during before_agent_start, ahead of the bridge: the task runs after it", task: "THE TASK", afterWelcome: true },
  { name: "welcome-after-task-started", title: "task started, then the welcome: the task runs first", task: "THE TASK", afterWelcome: false },
  { name: "input-transform", title: "an input transformer ahead of the bridge applies once", task: "PREFIX THE TASK", first: true, inputOnce: true },
  { name: "input-transform-welcome-first", title: "an input transformer ahead of the bridge applies once when the task waits for the welcome", task: "PREFIX THE TASK", afterWelcome: true, inputOnce: true },
  // The exception.
  { name: "welcome-in-input-behind", title: "exception: a welcome started in an input handler behind the bridge makes pi refuse the task, never duplicated or altered", refused: true },
  { name: "welcome-in-before-agent-start-behind", title: "exception: a welcome started in before_agent_start behind the bridge makes pi refuse the task, never duplicated or altered", refused: true },
  { name: "input-transform-welcome-in-before-agent-start-behind", title: "exception: with an input transformer ahead of the bridge, the refused task is never altered", refused: true, inputOnce: true },
];

export function assertScenario(result, scenario) {
  const why = JSON.stringify(result);
  assert.deepEqual(result.bridgeSent, [], `the bridge sends nothing: ${why}`);
  if (scenario.inputOnce) assert.deepEqual(result.inputSources, ["interactive"], `input processing ran once, on pi's own path: ${why}`);
  if (scenario.refused) {
    assert.notEqual(result.promptError, null, why);
    assert.deepEqual(users(result), [], `the refused task is neither duplicated nor altered: ${why}`);
    return;
  }
  assert.equal(result.promptError, null, why);
  assert.deepEqual(users(result), [scenario.task], why);
  if (scenario.first) assert.deepEqual(result.transcript.map((m) => m.role), ["user", "assistant"], why);
  if (scenario.afterWelcome === true) assert.ok(at(result, "WELCOME") >= 0 && at(result, scenario.task) > at(result, "WELCOME"), `the task runs after the welcome: ${why}`);
  if (scenario.afterWelcome === false) assert.ok(at(result, scenario.task) < at(result, "WELCOME"), `the task runs before the welcome: ${why}`);
}
