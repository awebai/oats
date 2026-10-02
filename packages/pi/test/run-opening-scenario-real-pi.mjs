/**
 * Runs one opening-task scenario in pi itself: an SDK session with a faux
 * model, the bridge (extension/index.ts) loaded by pi's own loader, and the
 * welcome turn @awebai/pi 0.3.10 starts at session_start. Prints what reached
 * the transcript as JSON.
 *
 *   node run-opening-scenario-real-pi.mjs <pi-coding-agent root> <pi-ai entry> <scenario> <instance-home>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [piRoot, piAiEntry, scenario, home] = process.argv.slice(2);
process.env.OATS_INSTANCE_HOME = home;
const pi = await import(pathToFileURL(join(piRoot, "dist", "index.js")).href);
const ai = await import(pathToFileURL(piAiEntry).href);
const BRIDGE = fileURLToPath(new URL("../extension/index.ts", import.meta.url));
const TASK = "THE TASK";

const faux = ai.fauxProvider({ tokensPerSecond: 200 });
faux.setResponses(Array.from({ length: 8 }, (_, i) => ai.fauxAssistantMessage(`reply ${i + 1}, long enough to stream for a while`)));
const modelRuntime = await pi.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);

// @awebai/pi 0.3.10 dist/index.js:10236-10244 (sendFirstSessionWelcome).
let fixtureApi;
const welcome = () => fixtureApi.sendMessage({ customType: "aweb-welcome", content: "WELCOME", display: true }, { deliverAs: "followUp", triggerTurn: true });
const times = (n, fn) => () => { if (n-- > 0) fn(); };
// Path extensions load before inline ones (core/resource-loader.js:402-420): this
// one's handlers run before the bridge's, the inline fixture's after.
const before = join(home, "before-bridge.mjs");
writeFileSync(before, "export default (pi) => pi.on(\"before_agent_start\", () => globalThis.oatsBeforeBridge?.());\n");

const scenarios = {
  "no-race": () => {},
  "welcome-first": () => welcome(),
  // The welcome starts during the task's preflight, before the bridge sees before_agent_start.
  "welcome-in-preflight": () => { globalThis.oatsBeforeBridge = times(1, welcome); },
  // The welcome starts during before_agent_start, after the bridge's handler ran.
  "welcome-in-before-agent-start": () => fixtureApi.on("before_agent_start", times(1, welcome)),
  "welcome-after-task-started": () => fixtureApi.on("message_start", (event) => { if (event.message.role === "user") times(1, welcome)(); }),
  "displaced-twice": () => { globalThis.oatsBeforeBridge = times(2, welcome); },
};

const loader = new pi.DefaultResourceLoader({
  cwd: home, agentDir: join(home, "agent"), noExtensions: true, noSkills: true,
  additionalExtensionPaths: [before, BRIDGE],
  extensionFactories: [(api) => { fixtureApi = api; }],
});
await loader.reload();
const { session } = await pi.createAgentSession({ cwd: home, agentDir: join(home, "agent"), model: faux.getModel(), modelRuntime, sessionManager: pi.SessionManager.inMemory(), resourceLoader: loader });
await session.bindExtensions({});
// The bridge's pi.sendUserMessage reaches AgentSession.sendUserMessage (core/agent-session.js:2020-2021).
const bridgeSent = [];
const sendUserMessage = session.sendUserMessage.bind(session);
session.sendUserMessage = (content, options) => { bridgeSent.push(content); return sendUserMessage(content, options); };
scenarios[scenario]();

let promptError = null;
await session.prompt(TASK).catch((e) => { promptError = e.message; });
const text = (m) => typeof m.content === "string" ? m.content : m.content.filter((c) => c.type === "text").map((c) => c.text).join("");
const snapshot = () => session.messages.map((m) => ({ role: m.role, text: m.role === "assistant" ? "reply" : text(m) }));
// Settled: idle, with an unchanged transcript for half a second.
for (let last = "", stable = 0; stable < 5;) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  const now = JSON.stringify(snapshot());
  stable = session.isIdle && now === last ? stable + 1 : 0;
  last = now;
}
console.log(JSON.stringify({ transcript: snapshot(), bridgeSent, promptError }));
process.exit(0);
