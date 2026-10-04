// `retirement.disposable.home` entries for the tests of every reader of a
// capability manifest (the loader, member discovery, package manifests) and of
// the published schema: they hold one rule, so they share one list.
import { KERNEL_HOME_RECEIPTS } from "../../lib/core.mjs";

/** [value, why refused]: "shape" is not one hidden top-level home name or
 *  prefix, "kernel-owned" covers a name the kernel owns in a home. */
export const DISPOSABLE_HOME_REFUSED = [
  ["notes", "shape"], [".", "shape"], ["..", "shape"], [".aw/keys", "shape"], [".aw/../x", "shape"],
  [".a*", "shape"], [".*", "shape"], [".x*y", "shape"], [".x-*/y", "shape"],
  [".oats", "kernel-owned"], [".agents", "kernel-owned"], [".claude", "kernel-owned"], [".oats-events.jsonl", "kernel-owned"],
  [".oats-attachments", "kernel-owned"], [".oats-start.lock", "kernel-owned"], [".oats-*", "kernel-owned"],
  // Every receipt the retirement fingerprint ignores in a home (lib/core.mjs KERNEL_HOME_RECEIPTS):
  // the fingerprint's list and the grammar's list cannot drift apart silently.
  ...[...KERNEL_HOME_RECEIPTS].filter((name) => name !== ".oats-events.jsonl").map((name) => [name, "kernel-owned"]),
];
/** Entries that are sound. */
export const DISPOSABLE_HOME_ACCEPTED = [".aw", ".oats-aweb", ".x-*"];
/** The contract's message for a refused entry of capability `id` (lib/capability-contract.mjs). */
export const disposableHomeRefusal = (id, value, why) => `capability ${id} manifest retirement.disposable.home entry ${JSON.stringify(value)} `
  + (why === "shape" ? "must name one hidden top-level home entry (\".name\", or \".prefix-*\")" : "covers a kernel-owned home entry");
