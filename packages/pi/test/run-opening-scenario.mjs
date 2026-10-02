/**
 * Runs one opening-task scenario: the real bridge (extension/index.ts) in a
 * PiHost, inside an OATS instance home, with the welcome turn @awebai/pi
 * 0.3.10 starts at session_start. Prints what reached the transcript as JSON.
 * Runs under `node --experimental-strip-types` (the bridge is TypeScript).
 *
 *   node --experimental-strip-types run-opening-scenario.mjs <scenario> <instance-home>
 */
import { PiHost } from "./pi-host.mjs";

const [scenario, home] = process.argv.slice(2);
process.env.OATS_INSTANCE_HOME = home;
const { default: bridge } = await import("../extension/index.ts");

const TASK = "THE TASK";
const host = new PiHost();
bridge(host.api());

/** The race fixture: registered after the bridge, as @awebai/pi would be or not. */
const fixture = host.api();
// @awebai/pi 0.3.10 dist/index.js:10236-10244 (sendFirstSessionWelcome).
const welcome = () => fixture.sendMessage({ customType: "aweb-welcome", content: "WELCOME", display: true }, { deliverAs: "followUp", triggerTurn: true });
const times = (n, fn) => () => { if (n-- > 0) fn(); };

/** The user messages the bridge sent, as pi received them. */
const bridgeSent = [];
const sendUserMessage = host.sendUserMessage.bind(host);
host.sendUserMessage = (content, options) => { bridgeSent.push(content); return sendUserMessage(content, options); };

const scenarios = {
  // The task is the session's first prompt and nothing else runs.
  "no-race": () => {},
  // The welcome turn is running when the task arrives.
  "welcome-first": () => welcome(),
  // The welcome starts while the task's prompt is in preflight, before before_agent_start.
  "welcome-in-preflight": () => { host.preflight = times(1, welcome); },
  // The welcome starts during before_agent_start, after the bridge's handler ran.
  "welcome-in-before-agent-start": () => fixture.on("before_agent_start", times(1, welcome)),
  // The task is accepted and its run has started when the welcome arrives.
  "welcome-after-task-started": () => fixture.on("message_start", (event) => { if (event.message.role === "user") times(1, welcome)(); }),
  // The welcome displaces the task, and a second welcome displaces its redelivery.
  "displaced-twice": () => { host.preflight = times(2, welcome); },
};
scenarios[scenario]();

let promptError = null;
await host.prompt(TASK).catch((e) => { promptError = e.message; });
await host.drain();

const result = { transcript: [...host.transcript], bridgeSent, promptError, extensionErrors: host.extensionErrors };
if (scenario === "no-race") {
  // Later input is not the opening: a prompt during a running turn without
  // streamingBehavior meets pi's own refusal, as it would without the bridge.
  welcome();
  result.laterError = await host.prompt("LATER").then(() => null, (e) => e.message);
  await host.drain();
  result.laterTranscript = host.transcript;
}
console.log(JSON.stringify(result));
