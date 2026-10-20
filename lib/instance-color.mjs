/** An instance's colour (feature instance-color, awebai/oats#1421 §2): presentation, never identity
 *  or an address. Anyone may set it at any time; it is a home file of its own, `<home>/.oats-color.json`,
 *  so that a start or restart, which rewrites instance.json, can never lose it.
 *
 *  The record is `{ colorApi: 1, color, at }`, written atomically (writeThroughPrivateFile) at mode
 *  0600; clearing removes the file. A reader takes a regular file only, without following a link, up
 *  to RECORD_MAX bytes: anything that is not a valid record reads as no colour (null), never an
 *  error. Dependency-free: the status rows, inspect and the command all read it through here. */
import { lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readFileHead } from "./bounded-read.mjs";
import { writeThroughPrivateFile } from "./write-through-private-file.mjs";

/** The closed palette, the clients' own (packages/client/soul-colors.mjs SOUL_COLORS): the kernel
 *  imports nothing from packages/, so it keeps this copy, which test/instance-color.test.mjs pins equal. */
export const INSTANCE_COLORS = Object.freeze(["sand", "sage", "slate", "mauve", "clay", "olive"]);
/** The record's own version, and the command answer's. */
export const COLOR_API = 1;
export const INSTANCE_COLOR_API = 1;
/** The home file, kernel-owned: in KERNEL_HOME_NAME_PREFIXES (lib/capability-contract.mjs), the retire
 *  fingerprint's receipts (lib/core.mjs KERNEL_HOME_RECEIPTS) and the manifest schema. */
export const COLOR_FILE = ".oats-color.json";
/** A record larger than this is not one. */
export const RECORD_MAX = 4096;

/** A palette name exactly, else null: what a reader keeps of any value (a relayed row's included). */
export const paletteColor = (value) => (typeof value === "string" && INSTANCE_COLORS.includes(value) ? value : null);

/** The colour `home` records, or null: no file, not a regular file (a link is never followed), over
 *  RECORD_MAX bytes, unreadable, not JSON, another colorApi or a name outside the palette. Never throws. */
export function readInstanceColor(home) {
  try {
    const { bytes, size } = readFileHead(join(home, COLOR_FILE), RECORD_MAX + 1);
    if (size > RECORD_MAX) return null;
    const record = JSON.parse(bytes.toString("utf8"));
    if (!record || typeof record !== "object" || Array.isArray(record) || record.colorApi !== COLOR_API) return null;
    return paletteColor(record.color);
  } catch { return null; }
}

/** Record `color` (a palette name) for `home`, or remove the record when `color` is null.
 *  → `{ color, changed }`. The colour the home already shows is no change: nothing is written. A clear
 *  removes whatever file stands at the name (an unreadable one included) and is a change only when a
 *  colour was shown. The caller validated `color` and holds the right to change the home. */
export function writeInstanceColor(home, color, { now = () => new Date() } = {}) {
  const path = join(home, COLOR_FILE);
  const before = readInstanceColor(home);
  if (color === null) {
    let present = false;
    try { lstatSync(path); present = true; } catch (e) { if (e?.code !== "ENOENT") throw e; }
    if (present) rmSync(path, { force: true });
    return { color: null, changed: before !== null };
  }
  if (before === color) return { color, changed: false };
  const bytes = JSON.stringify({ colorApi: COLOR_API, color, at: now().toISOString() }) + "\n";
  writeThroughPrivateFile(path, `${path}.tmp-${process.pid}`, bytes, 0o600);
  return { color, changed: true };
}
