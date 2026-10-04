// The host theme fixtures (test/fixtures/host-theme/, README there): a colors.toml's
// text, and the state main would send for it. Reads files; runs nothing.
import { readFileSync } from "node:fs";
import { parseColorsToml, resolveHostPalette } from "../../host-theme.mjs";

export const colorsToml = name => readFileSync(new URL(`../fixtures/host-theme/${name}.toml`, import.meta.url), "utf8");

/** The `omarchy` state main sends for a fixture that resolves. */
export function hostState(name) {
  const palette = resolveHostPalette(parseColorsToml(colorsToml(name)));
  if (!palette) throw new Error(`fixture ${name} does not resolve`);
  return { source: "omarchy", mode: palette.mode, colors: palette.colors };
}

/** A `system` state, with a problem when a reason is given. */
export const systemState = (mode, reason) => ({ source: "system", mode, ...(reason ? { problem: { origin: "omarchy", reason } } : {}) });
