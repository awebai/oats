// A stand-in TUI for warm-reader-lifeline.test.mjs: the real createReader over the fake kernel (fake.mjs) named in
// its one argument. It runs background cycles until one was read by the warm reader, then starts a plain
// long-lived child after the reader's pipe, writes its pids on one line and idles until it is killed.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cliRecord } from "../../lib/client.mjs";
import { createReader, leaveInstance } from "../../lib/read.mjs";

const { bin, collector, deployment, version, features, log } = JSON.parse(process.argv[2]);
const requests = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [])
  .filter((call) => call.action === "reader" && call.event === "request").length;
const reader = createReader({
  cli: cliRecord({ version, workspaceApi: 2, readerApi: 1, features }, { bin, source: "tui" }), env: leaveInstance({ ...process.env }), collector,
  getServed: () => [deployment], getEntry: () => null, onEntry: () => {}, onRoster: () => {},
  getRoster: () => ({ remote: { remoteGroups: [], rosterAnswered: false, rosterFailure: null }, memory: new Map(), notes: new Map() }),
});
await reader.start();
for (let i = 0; i < 200 && requests() === 0; i++) { await reader.request(); await new Promise((ok) => setTimeout(ok, 25)); }
const plain = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }).pid;
process.stdout.write(`${JSON.stringify({ tui: process.pid, plain, warm: requests() > 0 })}\n`);
setInterval(() => {}, 1000);
