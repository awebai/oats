/** What `oats retire` says about the work it preserved. One function renders
 *  the lines for the local and the remote path of bin/oats.mjs, from the
 *  receipt's `workRecovery` (lib/core.mjs, retireInstance). A receipt from an
 *  older kernel, or a stored one, may carry `workRecoveries[]` instead: one
 *  block is printed per entry. Dependency-free. */

export const formatBytes = (n) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KiB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MiB` : `${(n / 1024 ** 3).toFixed(1)} GiB`;

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** `a, b (owner); c (other)`: the `key` of each row, grouped by its owner; owners sorted, rows in their order. */
export function groupedByOwner(rows, key) {
  const groups = new Map();
  for (const row of rows) groups.set(row.owner, [...(groups.get(row.owner) || []), row[key]]);
  return [...groups].sort(([a], [b]) => byCodeUnit(String(a), String(b))).map(([owner, names]) => `${names.join(", ")}${owner ? ` (${owner})` : ""}`).join("; ");
}

/** `{ paths: [{ path, bytes }], bytes }` as one line: the first 8 with their size, then the total. */
function sizedPathsLine(label, part) {
  if (!part?.paths?.length) return [];
  const shown = part.paths.slice(0, 8).map((p) => `${p.path} (${formatBytes(p.bytes)})`);
  const more = part.paths.length > 8 ? `, and ${part.paths.length - 8} more` : "";
  return [`  ${label}: ${shown.join(", ")}${more} — ${formatBytes(part.bytes)} in total`];
}

/** The recoveries a retire receipt names: every entry of a historical `workRecoveries[]`, else its one `workRecovery`. */
export function receiptRecoveries(receipt) {
  if (Array.isArray(receipt?.workRecoveries) && receipt.workRecoveries.length) return receipt.workRecoveries;
  return receipt?.workRecovery ? [receipt.workRecovery] : [];
}

/** The lines `oats retire` prints for what a receipt preserved; `host` (the
 *  remote path) names where. Per recovery: the classes, the path with its
 *  size, then, when they apply, what was copied from the home, the copied
 *  outputs, the home entries left out by a capability's declaration (names and
 *  owners only) and which parts were copied again under after-hooks/. */
export function workRecoveryLines(receipt, { host } = {}) {
  const lines = [];
  for (const recovery of receiptRecoveries(receipt)) {
    lines.push(`Work that was not committed has been preserved${host ? ` on ${host}` : ""}: ${(recovery.classes || []).join(", ")}`);
    lines.push(`  ${recovery.path}${typeof recovery.bytes === "number" ? ` (${formatBytes(recovery.bytes)})` : ""}`);
    lines.push(...sizedPathsLine("copied from the home", recovery.home));
    lines.push(...sizedPathsLine("copied outputs", recovery.outputs));
    const notCopied = Array.isArray(recovery.notCopied) ? recovery.notCopied.filter((row) => typeof row?.path === "string") : [];
    if (notCopied.length) lines.push(`  not copied: ${groupedByOwner(notCopied, "path")}`);
    const again = [recovery.afterHooks?.home === true && "home", recovery.afterHooks?.work === true && "work"].filter(Boolean);
    if (again.length) lines.push(`  after the retire hooks: ${again.join(" and ")} copied again under after-hooks/`);
  }
  return lines;
}
