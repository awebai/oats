#!/usr/bin/env node
// turn-record — single shipped entry point.
//
//   turn-record capture [...]   land sessions and aw logs in the record
//   turn-record recall  [...]   search the record
//   turn-record dress   [...]   compose a budgeted spawning context
//   turn-record setup   [...]   install hooks + background watcher, run first pass
//
// The subcommand scripts read process.argv.slice(2), so the subcommand name
// is removed before importing them.

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
  case "dress":
    rest();
    await import("./dress.mjs");
    break;
  case "setup":
    rest();
    await import("./setup.mjs");
    break;
  default:
    console.error(
      "usage: turn-record <capture|recall|dress|setup> [options]\n" +
        "  capture [--watch|--status|--owner <name>|--root <dir>]\n" +
        "  recall  [--kind k] [--thread t] [--from f] [--show id] <query>\n" +
        "  dress   --thread <t> [--budget-chars N] [--since <ts>] [--out f]\n" +
        "  setup   [--owner <name>] [--no-service] [--no-hooks] [--dry-run]",
    );
    process.exit(sub === undefined || sub === "--help" || sub === "-h" ? 0 : 2);
}
