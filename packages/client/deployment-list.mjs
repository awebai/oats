/** This computer's deployments, as the kernel lists them (awebai/oats#1390): the `result` of
 * `oats deployments --json` (feature `deployments-list`, `deploymentsApi: 1`) read into rows of
 * `{ path, name, state }`. The list is the kernel's, kept in `~/.oats/config/deployments.json`; a client
 * reads it, never the file, and changes it only through `oats deployments add|remove|import`.
 *
 * A row's `state` comes from the kernel's existence check (nothing of the deployment is read): one of
 * DEPLOYMENT_STATES. Each client puts the four states into its own words. A row is a suggestion: a
 * client that opens one validates it again first (workspace-admission.mjs).
 *
 * The document's shape is closed (docs/desktop-cli-api.md): a key, a state or a `via` this reader does
 * not know, a duplicate path or a path that is not absolute refuses the whole document. It is never
 * guessed at, and never read in part. The answers of the writes are read here too. Nothing here keeps
 * state between calls. */
import { isAbsolute, resolve } from 'node:path';

/** The probe feature that makes `oats deployments` exist. */
export const DEPLOYMENTS_LIST_FEATURE = 'deployments-list';
/** The integer the list document carries. */
export const DEPLOYMENTS_API = 1;
/** Every state a row can have: `ok` (a deployment), `missing` (the path is gone, or on a volume not
 * mounted), `not-a-deployment` (the folder has no oats-local.yaml), `unreadable` (the check failed). */
export const DEPLOYMENT_STATES = Object.freeze(['ok', 'missing', 'not-a-deployment', 'unreadable']);
/** How a row joined the list: information only, never acted on. */
export const DEPLOYMENT_VIAS = Object.freeze(['onboard', 'tui', 'desktop', 'cli', 'import:agents-dir', 'import:desktop']);

const DOCUMENT_KEYS = ['deploymentsApi', 'file', 'deployments', 'imports'];
const ROW_KEYS = ['path', 'name', 'state', 'addedAt', 'via'];

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const text = (value) => typeof value === 'string' && value.length > 0 && !value.includes('\0');
/** An absolute path as the kernel stores it: canonical in form (no `.`, `..`, `//` or trailing `/`). */
export const listedPath = (value) => text(value) && isAbsolute(value) && resolve(value) === value;

/** Whether a probe (`oats version --json`, accepted) declares the list. */
export const deploymentsListSupported = (cli) => Array.isArray(cli?.features) && cli.features.includes(DEPLOYMENTS_LIST_FEATURE);

const refused = (reason) => ({ ok: false, rows: [], reason });

/**
 * @param {unknown} result  the envelope's `result` of `oats deployments --json`
 * @returns {{ ok: true, rows: Array<{ path: string, name: string, state: string }> } | { ok: false, rows: [], reason: string }}
 *   rows in the kernel's order; `reason` says, for a log, why the document was refused.
 */
export function readDeploymentList(result) {
  if (!record(result)) return refused('the list is not an object');
  if (result.deploymentsApi !== DEPLOYMENTS_API) return refused(`deploymentsApi is not ${DEPLOYMENTS_API}`);
  if (!exactKeys(result, DOCUMENT_KEYS)) return refused('the list has keys this client does not read');
  if (!listedPath(result.file)) return refused('file is not an absolute path');
  if (!record(result.imports) || !Object.values(result.imports).every(text)) return refused('imports is not a set of markers');
  if (!Array.isArray(result.deployments)) return refused('deployments is not a list');
  const rows = [], seen = new Set();
  for (const row of result.deployments) {
    if (!record(row) || !exactKeys(row, ROW_KEYS)) return refused('a row has keys this client does not read');
    if (!listedPath(row.path)) return refused('a row path is not an absolute path');
    if (seen.has(row.path)) return refused(`${row.path} is listed twice`);
    if (!text(row.name)) return refused(`${row.path} has no name`);
    if (!DEPLOYMENT_STATES.includes(row.state)) return refused(`${row.path} has a state this client does not know`);
    if (!text(row.addedAt)) return refused(`${row.path} has no addedAt`);
    if (!DEPLOYMENT_VIAS.includes(row.via)) return refused(`${row.path} has a via this client does not know`);
    seen.add(row.path);
    rows.push({ path: row.path, name: row.name, state: row.state });
  }
  return { ok: true, rows };
}

/* The answers of the three writes, each a closed `result` like the list's. Each reader answers its
 * fields, or null for a document it cannot read. */

/** `oats deployments add <dir> --json`: `{ path, added }`; `added` is false when the path was listed already. */
export function readDeploymentAdd(result) {
  return record(result) && exactKeys(result, ['path', 'added']) && listedPath(result.path) && typeof result.added === 'boolean'
    ? { path: result.path, added: result.added } : null;
}

/** `oats deployments remove <path> --json`: `{ path, removed }`; `removed` is false when the path was not listed. */
export function readDeploymentRemove(result) {
  return record(result) && exactKeys(result, ['path', 'removed']) && listedPath(result.path) && typeof result.removed === 'boolean'
    ? { path: result.path, removed: result.removed } : null;
}

/** `oats deployments import --from <client> <path>… --json`: `{ imported: true, at, added: [path…] }` the first
 * time, `{ imported: false, at }` after it (`at` is the import's marker). Either answer means the import is done. */
export function readDeploymentImport(result) {
  if (!record(result) || !text(result.at)) return null;
  if (result.imported === false) return exactKeys(result, ['imported', 'at']) ? { imported: false, at: result.at, added: [] } : null;
  if (result.imported !== true || !exactKeys(result, ['imported', 'at', 'added']) || !Array.isArray(result.added) || !result.added.every(listedPath)) return null;
  return { imported: true, at: result.at, added: [...result.added] };
}
