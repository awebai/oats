/**
 * Runs one pi process's session_start through the real bridge
 * (extension/index.ts) in a PiHost, inside an OATS instance home, and prints
 * the oats-memory messages the bridge sent as JSON. A restart is another run
 * on the same home. Runs under `node --experimental-strip-types`.
 *
 *   node --experimental-strip-types run-session-start.mjs <reason> <instance-home>
 */
import { PiHost } from "./pi-host.mjs";

const [reason, home] = process.argv.slice(2);
process.env.OATS_INSTANCE_HOME = home;
const { default: bridge } = await import("../extension/index.ts");

const host = new PiHost();
const api = host.api();
const sent = [];
bridge({ ...api, sendMessage: (message, options) => { sent.push({ message, options }); } });
await host.emit({ type: "session_start", reason });
process.stdout.write(JSON.stringify({ memory: sent.filter((s) => s.message.customType === "oats-memory") }));
