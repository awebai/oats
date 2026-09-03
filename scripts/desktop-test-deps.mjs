// Whether packages/desktop's own npm dependencies are installed.
//
// The desktop suites (packages/desktop/test/*.test.mjs) import jsdom directly
// and reach marked/dompurify/highlight.js through the renderer modules they
// exercise. All four are declared in packages/desktop/package.json, NOT in the
// root manifest, so a checkout that only ran root `npm ci` cannot load them.
// Root `npm test` discovers those suites through its packages/** glob, so it
// has to know whether they are loadable before it hands them to node --test.
//
// Both the root runner (scripts/run-tests.mjs) and the release-workflow test
// import this, so the dependency list and the install command have one home.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Exact command that installs them (kept in sync with .github/workflows). */
export const DESKTOP_TEST_DEPS_INSTALL =
  "(cd packages/desktop && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci)";

/** Bare specifiers the desktop suites load, directly or transitively. */
export const DESKTOP_TEST_DEPS = ["jsdom", "marked", "dompurify", "highlight.js"];

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const DESKTOP_DIR = join(REPO_ROOT, "packages", "desktop");

// Resolution is deliberately a filesystem walk rather than require.resolve():
// several of these packages are ESM-only or ship an "exports" map without a
// require condition, so require.resolve() can throw for a package that IS
// installed. Walking node_modules upward from packages/desktop matches how
// node finds a bare specifier, and so also credits a dependency that npm
// hoisted into the root node_modules.
function installed(specifier) {
  let dir = DESKTOP_DIR;
  for (;;) {
    if (existsSync(join(dir, "node_modules", specifier, "package.json"))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** @returns {{ ok: boolean, missing: string[] }} */
export function desktopTestDeps() {
  const missing = DESKTOP_TEST_DEPS.filter((d) => !installed(d));
  return { ok: missing.length === 0, missing };
}

export function desktopTestDepsInstalled() {
  return desktopTestDeps().ok;
}
