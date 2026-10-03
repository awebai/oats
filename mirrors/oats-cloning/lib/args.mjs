import { fail } from "./errors.mjs";

// Strict argv parsing: an unknown flag, a missing value or a repeated value
// flag is a usage error, never silently ignored. `--flag=value` and
// `--flag value` are both accepted.
export function parseArgs(argv, { values = [], switches = [], positionals = 0 } = {}) {
  const valueSet = new Set(values), switchSet = new Set(switches);
  const flags = Object.create(null);
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") fail("E_CLONE_USAGE", "unexpected --");
    if (!a.startsWith("--")) { rest.push(a); continue; }
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (switchSet.has(name)) {
      if (eq > 0) fail("E_CLONE_USAGE", `--${name} takes no value`);
      flags[name] = true;
      continue;
    }
    if (!valueSet.has(name)) fail("E_CLONE_USAGE", `unknown flag --${name}`);
    let value;
    if (eq > 0) value = a.slice(eq + 1);
    else {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) fail("E_CLONE_USAGE", `--${name} needs a value`);
      i++;
    }
    if (name in flags) fail("E_CLONE_USAGE", `--${name} given more than once`);
    flags[name] = value;
  }
  if (rest.length > positionals) fail("E_CLONE_USAGE", `unexpected argument ${JSON.stringify(rest[positionals])}`);
  return { flags, positionals: rest };
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isSlug = (s) => typeof s === "string" && s.length <= 64 && SLUG.test(s);

/** The kernel's slug rule: lowercase, runs of anything else become one dash. */
export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
