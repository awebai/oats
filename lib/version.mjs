/** The kernel's package root, version and npm name, read from package.json once at load. A leaf
 *  (awebai/oats#1630): `oats version` reads it without loading core.mjs, which re-exports the first two.
 *  Node built-ins only. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Package root (this file lives in <pkg>/lib/). */
export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
export const OATS_VERSION = manifest.version;
/** The npm name this kernel was installed under: what it updates and installs itself as. One code base
 *  published under two names answers each with its own. */
export const OATS_PACKAGE_NAME = manifest.name;
