#!/usr/bin/env node
// turn-record — single shipped entry point for the record core.
//
//   turn-record capture [...]   land sessions and aw logs in the record
//   turn-record recall  [...]   search the record
//   turn-record setup   [...]   install hooks + background watcher, run first pass
//
// The experimental tools over the record (dress, spawn, segments, mind)
// live in packages/experimental of the oats repo and run as
// `oats experimental <cmd>`; they are not part of this package.
//
// The subcommand scripts read process.argv.slice(2), so the subcommand name
// is removed before importing them.

const EXPERIMENTAL = new Set(["dress", "segments", "spawn", "mind"]);
const sub = process.argv[2];
const rest = () => process.argv.splice(2, 1);

switch (sub) {
  case "capture":
    rest();
    await import("./capture.mjs");
    break;
  case "recall":
    rest();
    await import("./recall.mjs");
    break;
  case "setup":
    rest();
    await import("./setup.mjs");
    break;
  default:
    if (EXPERIMENTAL.has(sub)) {
      console.error(
        `turn-record: "${sub}" is an experimental tool and moved out of this package.\n` +
          `Run it from an oats repo checkout: oats experimental ${sub} [options]`,
      );
      process.exit(2);
    }
    console.error(
      "usage: turn-record <capture|recall|setup> [options]\n" +
        "  capture [--watch|--status|--owner <name>|--root <dir>]\n" +
        "  recall  [--kind k] [--thread t] [--from f] [--show id] <query>\n" +
        "  setup   [--owner <name>] [--no-service] [--no-hooks] [--dry-run]",
    );
    process.exit(sub === undefined || sub === "--help" || sub === "-h" ? 0 : 2);
}
