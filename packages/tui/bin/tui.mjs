// The entry of `oats tui`, loaded by bin/oats.mjs with one dynamic import.
// The import below loads every module of packages/tui/lib/ statically, BEFORE the terminal is
// looked at: `oats tui` with no terminal therefore proves that the installed package holds the
// whole module graph (scripts/clean-room-smoke.mjs runs exactly that).
import { main } from "../lib/main.mjs";

process.exitCode = await main({ argv: process.argv.slice(2), stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, env: process.env });
