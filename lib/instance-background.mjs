/** Whether an instance is background (feature instance-background, awebai/oats#1579): presentation like
 *  the colour (lib/instance-color.mjs), never identity or policy. A client lists a background instance
 *  under its own section; nothing else about the instance changes. It is a home file of its own,
 *  `<home>/.oats-background.json`, so that a start or restart, which rewrites instance.json, can never
 *  lose it; a later edit of the soul does not move an existing home.
 *
 *  The record is `{ backgroundApi: 1, at }` (#1579 item 3: present means background), written atomically
 *  (writeThroughPrivateFile) at mode 0600; absent means not background, and `off` removes the file. A
 *  reader takes a regular file only, without following a link, up to RECORD_MAX bytes: anything that is
 *  not a valid record reads as not background (false), never an error. Dependency-free: spawn, the status
 *  rows, inspect and the command all read and write it through here. */
import { lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readFileHead } from "./bounded-read.mjs";
import { writeThroughPrivateFile } from "./write-through-private-file.mjs";

/** The record's own version, and the command answer's. */
export const BACKGROUND_API = 1;
export const INSTANCE_BACKGROUND_API = 1;
/** The home file, kernel-owned: in KERNEL_HOME_NAME_PREFIXES (lib/capability-contract.mjs), the retire
 *  fingerprint's receipts (lib/core.mjs KERNEL_HOME_RECEIPTS) and the manifest schema. */
export const BACKGROUND_FILE = ".oats-background.json";
/** A record larger than this is not one. */
export const RECORD_MAX = 4096;

/** Whether `home` records itself background: false for no file, not a regular file (a link is never
 *  followed), over RECORD_MAX bytes, unreadable, not a JSON object or another backgroundApi. Never throws. */
export function readInstanceBackground(home) {
  try {
    const { bytes, size } = readFileHead(join(home, BACKGROUND_FILE), RECORD_MAX + 1);
    if (size > RECORD_MAX) return false;
    const record = JSON.parse(bytes.toString("utf8"));
    return !!record && typeof record === "object" && !Array.isArray(record) && record.backgroundApi === BACKGROUND_API;
  } catch { return false; }
}

/** Record `home` as background (`on` true), or remove the record (`on` false). → `{ background, changed }`.
 *  A home already background is no change: nothing is written. `off` removes whatever file stands at the
 *  name (a link or an invalid record included) and is a change only when the home read as background.
 *  The caller holds the right to change the home. */
export function writeInstanceBackground(home, on, { now = () => new Date() } = {}) {
  const path = join(home, BACKGROUND_FILE);
  const before = readInstanceBackground(home);
  if (!on) {
    let present = false;
    try { lstatSync(path); present = true; } catch (e) { if (e?.code !== "ENOENT") throw e; }
    if (present) rmSync(path, { force: true });
    return { background: false, changed: before };
  }
  if (before) return { background: true, changed: false };
  const bytes = JSON.stringify({ backgroundApi: BACKGROUND_API, at: now().toISOString() }) + "\n";
  writeThroughPrivateFile(path, `${path}.tmp-${process.pid}`, bytes, 0o600);
  return { background: true, changed: true };
}
