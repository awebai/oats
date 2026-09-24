// Spawn preview/apply fixtures from the kernel: test/fixtures/workspace-v2/f3
// (repo kernel 0.25.7 against a scratch Northwind build; provenance.json).
// The CLI facts are the captured `oats version --json`; the preview and the
// creation receipt are the captured `spawn … --preview --json` and
// `spawn … --expect-decision … --json` documents. Tests mutate copies.
import { readFileSync } from 'node:fs';
export const kernel = name => JSON.parse(readFileSync(new URL(`../fixtures/workspace-v2/f3/${name}.json`, import.meta.url), 'utf8'));
const version = kernel('version');
export const cli = { ok: true, bin: '/fixture/oats', version: version.version, spawnPreviewApi: version.spawnPreviewApi, spawnApplyApi: version.spawnApplyApi,
  workspaceApi: version.workspaceApi, features: [...version.features], runtimes: [...version.runtimes], sessionBackends: [...version.sessionBackends],
  launchOptions: [...version.launchOptions], remote: [...version.remote] };
export const DEPLOYMENT = '/fixture/base/northwind-workspace';
export const ROOT = `${DEPLOYMENT}/agents`;
export const workspace = { id: 'northwind', scope: DEPLOYMENT };
export const soul = { name: 'release-manager', agentsRoot: ROOT, work: 'worktree' };
export const selector = { soul: soul.name, agentsRoot: soul.agentsRoot };
export const target = { workspace: workspace.id, context: DEPLOYMENT, selector };
/** An instance the captured concurrent apply created — a real relation anchor. */
export const anchor = { instance: 'release-manager-race', agent: 'release-manager', agentsRoot: ROOT, server: null };
export const anchorHome = `${ROOT}/release-manager/instances/release-manager-race`;
export const context = () => ({ workspace: { ...workspace }, cli: structuredClone(cli),
  agents: [{ ...soul }, { name: 'platform-reviewer', agentsRoot: ROOT, work: 'checkout' }, { name: 'support-triager', agentsRoot: ROOT, work: 'directory' }],
  instances: [{ ...anchor, home: anchorHome, createdAt: 'first' }] });
export const request = choices => ({ action: 'preview', selector, choices: choices ?? {} });
/** The kernel preview for release-manager --purpose api-v2 (default: the one the captured apply bound). */
export function data(_target = target, name = 'preview-worktree-purpose') { return kernel(name).result; }
export const view = (t = target, v = data(t)) => ({ spawnPreviewViewApi: 1, status: 'available', target: t, data: v, reason: null });
export const envelope = v => ({ schemaVersion: 1, ok: true, result: v });
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
export const tick = () => new Promise(resolve => setImmediate(resolve));
