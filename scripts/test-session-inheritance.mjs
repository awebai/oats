#!/usr/bin/env node
// `npm run test:session`: the suites that followed a variable of the session that ran them
// (awebai/oats#972), run with every such variable set to a value that cannot work.
//
// A fixture never inherits the session's variables: test/helpers/host-fixture.mjs holds the one
// definition (SESSION_VARIABLES) and every helper that builds an environment uses it. A suite run
// from an agent instance's session has all of them set; CI's ordinary shards have none, so a test
// that reads one passes there and fails for the next developer agent. This run is CI's own session:
// it fails where such a test is written. Pull-request CI runs it as the `session-inheritance` job,
// which the gate requires (test/continuous-integration.test.mjs pins both).
//
//   npm run test:session                                     the suites below
//   npm run test:session -- test/login-environment.test.mjs  that file alone (any test file)
//
// Flags are forwarded to node --test.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "./desktop-test-deps.mjs";
import { SESSION_VARIABLES, isSessionVariable } from "../test/helpers/host-fixture.mjs";

/** The suites this run covers: each has followed a variable of the session that ran it. */
export const SESSION_SUITES = ["test/capabilities.test.mjs", "test/golden-fixtures.test.mjs", "test/harness-trust-launch.test.mjs", "test/login-environment.test.mjs"];

/** Nothing exists here: a configuration directory, a home or a socket under it cannot be read. */
const NOWHERE = "/nonexistent/oats-session-poison";
/** For each prefix of the definition, the names an instance's session really has. They are
 *  instances of the definition, not a second one: a prefix the definition gains must be given its
 *  names here, and a name here that the definition does not cover is refused. (The definition's
 *  legacy prefixes are names no session has: this run sets none.) */
const SESSION_NAMES = {
  OATS_: ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME"],
  AWEB_: ["AWEB_IDENTITY_HOME", "AWEB_DELIVERY"],
};
/** A name under `prefix` that nothing knows: a helper that drops by prefix drops it, one that
 *  lists the names it knows does not. */
const unknownName = (prefix) => `${prefix}NOTHING_KNOWS_THIS`;
/** Values that are not a path: a display and a pane that do not exist, a tmux client's server
 *  that does not exist, an instance and a delivery nothing has. Every other name gets a path
 *  under NOWHERE. */
const SHAPED = {
  DISPLAY: ":4094",
  TMUX: `${NOWHERE}/tmux-socket,4094,0`,
  TMUX_PANE: "%4094",
  OATS_INSTANCE: "session-poison-instance",
  AWEB_DELIVERY: "session-poison",
};

/** Every variable of the definition, set to a value that cannot work: its names, and for each of
 *  its prefixes the session's own names and one that nothing knows. */
export function poisonedSession() {
  const names = [...SESSION_VARIABLES.names];
  for (const prefix of SESSION_VARIABLES.prefixes) {
    const known = SESSION_NAMES[prefix];
    if (!known) throw new Error(`the session definition has the prefix ${prefix}, and this run knows no name under it: add the names a session has to SESSION_NAMES`);
    names.push(...known, unknownName(prefix));
  }
  for (const prefix of Object.keys(SESSION_NAMES)) {
    if (!SESSION_VARIABLES.prefixes.includes(prefix)) throw new Error(`this run sets names under ${prefix}, which is not a prefix of the session definition (test/helpers/host-fixture.mjs SESSION_VARIABLES)`);
  }
  for (const name of [...names, ...Object.keys(SHAPED)]) {
    if (!isSessionVariable(name)) throw new Error(`this run would set ${name}, which the session definition does not cover (test/helpers/host-fixture.mjs SESSION_VARIABLES)`);
  }
  return Object.fromEntries(names.map((name) => [name, SHAPED[name] ?? `${NOWHERE}/${name.toLowerCase()}`]));
}

function main(argv) {
  const flags = argv.filter((a) => a.startsWith("-")), files = argv.filter((a) => !a.startsWith("-"));
  const poison = poisonedSession();
  console.log(`session inheritance: ${Object.keys(poison).length} variables of the session set to values that cannot work\n  ${Object.keys(poison).join(" ")}`);
  // Flags before the files: node --test reads a flag after the first positional as a file.
  const run = spawnSync(process.execPath, ["--test", ...flags, ...(files.length ? files : SESSION_SUITES)], { cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env, ...poison } });
  if (run.error) throw run.error;
  if (run.status !== 0) console.error("\nsession inheritance: a test followed a variable of the session that ran it. A fixture never inherits one: build the environment through test/helpers/host-fixture.mjs (docs/implementation.md, \"An explicit environment for every child\").");
  return run.status ?? 1;
}

// Run, unless imported (the test that pins this run reads its suites and its variables).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
