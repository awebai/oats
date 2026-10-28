/** The order of two kernel or package versions. A leaf (awebai/oats#1630): `oats workspace status`
 *  compares versions without loading servers.mjs, which imports it and re-exports it. */

export function compareSemver(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => Number.parseInt(x, 10));
  const pb = String(b).split(/[.-]/).map((x) => Number.parseInt(x, 10));
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}
