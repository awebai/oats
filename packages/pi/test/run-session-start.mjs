/**
 * Runs one pi process's session_start through the real bridge
 * (extension/index.ts) in a PiHost, inside an OATS instance home, and prints
 * the oats-memory messages the bridge sent as JSON. The session manager is
 * pi's, reduced to what the bridge reads: the home's sessions directory and
 * this session's file in it. Runs under `node --experimental-strip-types`.
 *
 *   node --experimental-strip-types run-session-start.mjs <reason> <instance-home> <sessions-dir> <session-file>
 */
import { PiHost } from "./pi-host.mjs";

const [reason, home, sessionDir, sessionFile] = process.argv.slice(2);
process.env.OATS_INSTANCE_HOME = home;
const { default: bridge } = await import("../extension/index.ts");

const host = new PiHost();
const context = host.context.bind(host);
// core/session-manager.js:625-640 (pi 0.80.3); the cwd is the home, where OATS launches pi.
host.context = () => ({ ...context(), sessionManager: { getSessionDir: () => sessionDir, getSessionFile: () => sessionFile, getCwd: () => home } });
const sent = [];
bridge({ ...host.api(), sendMessage: (message, options) => { sent.push({ message, options }); } });
await host.emit({ type: "session_start", reason });
process.stdout.write(JSON.stringify({ memory: sent.filter((s) => s.message.customType === "oats-memory") }));
