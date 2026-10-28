/** The kernel's package root and version, read from package.json once at load. A leaf (awebai/oats#1630):
 *  `oats version` reads it without loading core.mjs, which re-exports both. Node built-ins only. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Package root (this file lives in <pkg>/lib/). */
export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const OATS_VERSION = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")).version;
