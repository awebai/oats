// Optional display metadata from a successful native mint, never an authority
// gate. Validate the pair atomically so an invalid row cannot imply a partial
// delegation. Bounds limit persisted/output data, not native grant authority.
export const INVENTORY_ERROR = 'E_GRANT_APP_INVENTORY: grant app inventory unavailable; native inventory was malformed';
const codes = new Set(['app_missing', 'app_manifest_invalid', 'app_origin_mismatch', 'app_manifest_mismatch', 'app_origin_denied']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && value.trim() === value && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
// Native validatePluginName permits ASCII case and underscores, but no leading hyphen.
const appId = value => text(value) && /^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(value);
// Deliberately narrower informational recording grammar than native tool names.
// A rejected name makes metadata unavailable, never invalidates mint authority.
const toolId = value => text(value) && /^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(value);
const keys = (value, names) => object(value) && Object.keys(value).length === names.length && names.every(k => Object.hasOwn(value, k));
const unavailable = malformed => ({ appInventoryStatus: 'unavailable', ...(malformed ? { appInventoryError: 'E_GRANT_APP_INVENTORY' } : {}) });
function validOrigin(value) {
  if (!text(value)) return false;
  // Match canonicalAppOrigin's scheme/host/port-only output. Do not turn a
  // path-bearing receipt into an origin by normalizing away its private tail.
  const match = /^(https?):\/\/(\[[0-9a-f:]+\]|[^:/?#@\\]+)(?::([0-9]+))?$/.exec(value);
  if (!match) return false;
  const [, scheme, host, port] = match;
  if (host !== host.toLowerCase() || host.endsWith('.') ||
      (scheme === 'https' && port === '443') || (scheme === 'http' && port === '80')) return false;
  try { const u = new URL(value); return !!u.hostname && !u.username && !u.password && !u.search && !u.hash; }
  catch { return false; }
}
export function grantAppInventory(receipt) {
  if (!object(receipt)) return unavailable(true);
  const a = Object.hasOwn(receipt, 'apps'), s = Object.hasOwn(receipt, 'skipped_apps');
  if (!a && !s) return unavailable(false);
  if (!a || !s || !Array.isArray(receipt.apps) || !Array.isArray(receipt.skipped_apps) || receipt.apps.length + receipt.skipped_apps.length > 256) return unavailable(true);
  if (Buffer.byteLength(JSON.stringify([receipt.apps, receipt.skipped_apps]), "utf8") > 65536) return unavailable(true);
  const seen = new Set(), apps = [], skipped_apps = [];
  for (const row of receipt.apps) {
    if (!keys(row, ['app_id','origin','manifest_sha256','tools']) || !appId(row.app_id) || seen.has(row.app_id) || !validOrigin(row.origin) || typeof row.manifest_sha256 !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(row.manifest_sha256) || !Array.isArray(row.tools) || row.tools.length > 1024 || row.tools.some(t => !toolId(t)) || new Set(row.tools).size !== row.tools.length) return unavailable(true);
    seen.add(row.app_id);
    apps.push({ app_id: row.app_id, origin: row.origin, manifest_sha256: row.manifest_sha256, tools: [...row.tools] });
  }
  for (const row of receipt.skipped_apps) {
    if (!keys(row, ['app_id','code']) || !appId(row.app_id) || seen.has(row.app_id) || !codes.has(row.code)) return unavailable(true);
    seen.add(row.app_id); skipped_apps.push({ app_id: row.app_id, code: row.code });
  }
  return { appInventoryStatus: 'known', apps, skipped_apps };
}
export function grantInventoryAdvisory(grant, { retained = false, pending = false } = {}) {
  const inventory = grantAppInventory(grant || {});
  const id = text(grant?.id) ? JSON.stringify(grant.id) : '(unavailable)';
  const label = retained ? 'Retained last-successful grant snapshot' : 'At-mint grant snapshot';
  const malformed = inventory.appInventoryError || grant?.appInventoryError === 'E_GRANT_APP_INVENTORY';
  const state = inventory.appInventoryStatus === 'known'
    ? `delegated apps ${JSON.stringify(inventory.apps.map(({ app_id, tools }) => ({ app_id, tool_count: tools.length })))}; skipped (not delegated) ${JSON.stringify(inventory.skipped_apps)}`
    : `app inventory unavailable${malformed ? `; ${INVENTORY_ERROR}` : ' (legacy or unrecorded receipt)'}`;
  return `${label} ${id}: ${state}. ${pending ? 'Pending re-mint inventory is unknown until its successful receipt. ' : ''}Use oats inspect --home <home> --json for the full current recorded grant. Inventory is not a readiness verdict; unavailable does not mean no app authority.`;
}
