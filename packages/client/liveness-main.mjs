// The liveness collector as a program: rows on stdin, one liveness per row on stdout
// (liveness.mjs). The backend starts it out of its own process (packages/desktop/server/oats-web.mjs) so a slow
// terminal server cannot stall request handling. It runs as Node under the packaged executable,
// started with the environment the backend was started with, and it starts tmux itself: so its
// first import cleans its own environment (own-environment.mjs), and that import must stay first.
import "./own-environment.mjs";
import { readFileSync } from "node:fs";
import { observeLiveness } from "./liveness.mjs";

process.stdout.write(JSON.stringify(observeLiveness(JSON.parse(readFileSync(0, "utf8")))));
