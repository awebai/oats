#!/usr/bin/env node
// oats cloning request|dossier|spawn: the oats.cloning commands.
// Run through the kernel (`oats cloning …`), which sets OATS_CLI_BIN,
// OATS_SETTINGS and, inside an instance, OATS_INSTANCE / OATS_INSTANCE_HOME.
// With --json each prints exactly one envelope: { ok: true, … } or
// { ok: false, error: { code, message, details? } }, exiting nonzero on failure.
import { CloneError } from "../lib/errors.mjs";
import { request } from "../lib/request.mjs";
import { dossier } from "../lib/dossier.mjs";
import { spawnClone } from "../lib/spawn.mjs";
import { summarize } from "../lib/human.mjs";

const COMMANDS = { request, dossier, spawn: spawnClone };
const [command, ...argv] = process.argv.slice(2);
const json = argv.includes("--json");

function emitFailure(code, message, details) {
  if (json) process.stdout.write(JSON.stringify({ ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } }) + "\n");
  else process.stderr.write(`oats cloning ${command ?? ""}: ${code}: ${message}\n`);
  process.exitCode = 1;
}

const run = COMMANDS[command];
if (!run) emitFailure("E_CLONE_USAGE", `usage: oats cloning ${Object.keys(COMMANDS).join("|")} … (got ${JSON.stringify(command ?? "")})`);
else {
  try {
    const result = run(argv);
    if (json) process.stdout.write(JSON.stringify({ ok: true, ...result }) + "\n");
    else process.stdout.write(summarize(command, result) + "\n");
  } catch (e) {
    if (e instanceof CloneError) emitFailure(e.code, e.message, e.details);
    else emitFailure("E_CLONE_INTERNAL", e?.message || String(e));
  }
}
