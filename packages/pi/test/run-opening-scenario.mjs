/**
 * Runs one opening-task scenario: the real bridge (extension/index.ts) in a
 * PiHost, inside an OATS instance home, with the welcome turn @awebai/pi
 * 0.3.10 starts at session_start. Prints what reached the transcript as JSON.
 * Runs under `node --experimental-strip-types` (the bridge is TypeScript).
 *
 *   node --experimental-strip-types run-opening-scenario.mjs <scenario> <instance-home>
 */
import { PiHost } from "./pi-host.mjs";

const [name, home] = process.argv.slice(2);
process.env.OATS_INSTANCE_HOME = home;
const { default: bridge } = await import("../extension/index.ts");

const TASK = "THE TASK";
const host = new PiHost();
// Fixtures registered before the bridge run their handlers ahead of its own;
// those registered after, behind.
const before = host.api();
const after = host.api();
// @awebai/pi 0.3.10 dist/index.js:10236-10244 (sendFirstSessionWelcome).
const welcome = () => after.sendMessage({ customType: "aweb-welcome", content: "WELCOME", display: true }, { deliverAs: "followUp", triggerTurn: true });
const times = (n, fn) => () => { if (n-- > 0) fn(); };
/** The sources of the input events an input transformer ahead of the bridge saw. */
const inputSources = [];
function transformInput() {
  before.on("input", (event) => {
    inputSources.push(event.source);
    return { action: "transform", text: `PREFIX ${event.text}` };
  });
}

const scenarios = {
  // The task is the session's first prompt and nothing else runs.
  "no-race": {},
  // The welcome turn is running when the task arrives.
  "welcome-first": { start: () => welcome() },
  // The welcome starts while the task's prompt is in preflight, before before_agent_start.
  "welcome-in-preflight": { before: () => { host.preflight = times(1, welcome); } },
  // The same, with an extension ahead of the bridge awaiting in agent_start.
  "welcome-in-preflight-slow-agent-start": {
    before: () => {
      host.preflight = times(1, welcome);
      before.on("agent_start", () => new Promise((resolve) => setTimeout(resolve, 50)));
    },
  },
  // The welcome starts during before_agent_start, in a handler ahead of the bridge's.
  "welcome-in-before-agent-start-ahead": { before: () => before.on("before_agent_start", times(1, welcome)) },
  // The welcome starts during before_agent_start, behind the bridge's handler.
  "welcome-in-before-agent-start-behind": { after: () => after.on("before_agent_start", times(1, welcome)) },
  // The task is accepted and its run has started when the welcome arrives.
  "welcome-after-task-started": { after: () => after.on("message_start", (event) => { if (event.message.role === "user") times(1, welcome)(); }) },
  // A welcome behind the bridge's before_agent_start displaces the task, and a second one its resend.
  "displaced-twice": { after: () => after.on("before_agent_start", times(2, welcome)) },
  // An input transformer ahead of the bridge, without and with a running welcome.
  "input-transform": { before: transformInput },
  "input-transform-welcome-first": { before: transformInput, start: () => welcome() },
  // A pi without agent_settled: the welcome turn is running when the task arrives.
  "welcome-first-without-agent-settled": { before: () => { host.withoutAgentSettled = true; }, start: () => welcome() },
};

const scenario = scenarios[name];
scenario.before?.();
/** The user messages the bridge sent, as pi received them. */
const bridgeSent = [];
const bridgeApi = host.api();
bridge({ ...bridgeApi, sendUserMessage: (content, options) => { bridgeSent.push(content); bridgeApi.sendUserMessage(content, options); } });
scenario.after?.();
scenario.start?.();

let promptError = null;
await host.prompt(TASK).catch((e) => { promptError = e.message; });
await host.drain();

const result = { transcript: [...host.transcript], bridgeSent, promptError, inputSources, extensionErrors: host.extensionErrors };
if (name === "no-race") {
  // Later input is not the opening: a prompt during a running turn without
  // streamingBehavior meets pi's own refusal, as it would without the bridge.
  welcome();
  result.laterError = await host.prompt("LATER").then(() => null, (e) => e.message);
  await host.drain();
}
console.log(JSON.stringify(result));
