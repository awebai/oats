/** Read the setup edition as data for a CLASSIC local bootstrap copy.
 * No provider code, workspace activation, enrollment or captured identity. */
import { lstatSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parsePortableSoul } from './portable-soul.mjs';
import { parseRepositorySource, parsePortableSource } from './source-spec.mjs';
import { createRepositoryTransaction } from './repository-observation.mjs';
import { createWorkspaceDiscovery } from './workspace-discovery.mjs';
import { packageIntegrity } from './core.mjs';
import { oatsError } from './errors.mjs';

export const SETUP_EXPERT = 'oats-setup-expert';
export const SETUP_CAPABILITIES = Object.freeze(['oats.core', 'oats.setup']);
const EXPORT = `souls/${SETUP_EXPERT}`;
function validateEdition(bytes) {
  const { declaration: soul } = parsePortableSoul(bytes);
  const required = soul.requires || {}, caps = required.capabilities || {};
  if (soul.name !== SETUP_EXPERT || soul.work !== 'directory'
      || Object.keys(required).some(key => key !== 'capabilities')
      || Object.keys(caps).length !== 2 || SETUP_CAPABILITIES.some(id => caps[id]?.source !== 'repo:oats-package' || Object.keys(caps[id]).some(key => key !== 'source'))
      || ['knowledge', 'messaging', 'tasks'].some(slot => soul.defaults?.[slot] !== 'none')
      || Object.keys(soul.defaults || {}).some(key => !['knowledge', 'messaging', 'tasks'].includes(key))
      || soul.knowledge || soul.teams?.length || soul.resources?.length || soul.yolo === true || soul.backend || soul['launch-config']) {
    throw oatsError('needs-configuration', 'classic setup bootstrap needs the provider-independent directory edition with only oats.core/oats.setup; use explicit portable preparation for other requirements');
  }
  return soul;
}
function repositoryRequest(source) {
  if (typeof source !== 'string' || source.includes('#')) throw oatsError('invalid-source', '--workspace needs a Git repository source, optionally @revision, without a package fragment');
  try { return { source: parseRepositorySource(source).normalized }; }
  catch {
    const parsed = parsePortableSource(source);
    if (parsed.kind !== 'git') throw oatsError('invalid-source', '--workspace needs an explicit Git repository source');
    return { source: `git:${parsed.url}`, revision: parsed.selector };
  }
}

export function loadSetupExpertEdition(workspace, repositoryOptions = {}) {
  if (workspace === undefined) {
    const root = fileURLToPath(new URL(`../${EXPORT}/`, import.meta.url));
    return { declaration: validateEdition(readFileSync(join(root, 'soul.yaml'))), instructions: readFileSync(join(root, 'AGENTS.md'), 'utf8'),
      source: { kind: 'packaged-definition', captured: false }, packageIntegrity: null };
  }
  const request = repositoryRequest(workspace), scratch = realpathSync(mkdtempSync(join(tmpdir(), 'oats-setup-source-'))), owned = lstatSync(scratch);
  let transaction;
  try {
    transaction = createRepositoryTransaction({ ...repositoryOptions, directory: scratch, accessContextKey: 'explicit-setup-source' });
    const discovery = createWorkspaceDiscovery(transaction), origin = { kind: 'operator', document: { kind: 'operator', id: 'oats-onboard' }, pointer: '/workspace' };
    const observed = transaction.observe(request.source, { ...request, origin });
    const workspaceDoc = transaction.readFile(observed, 'oats-workspace.yaml', { optional: true });
    const view = workspaceDoc ? discovery.readWorkspace({ ...request, origin }) : null;
    const reference = view?.parsed.imports.find(item => item.alias === SETUP_EXPERT)
      ?? { source: request.source, revision: observed.source.commit, soul: EXPORT, alias: SETUP_EXPERT };
    // A selected workspace import never falls back if its exact source fails.
    const imported = discovery.importSoul(reference, { origin });
    if (reference.adoption) throw oatsError('needs-configuration', 'classic setup copies an edition only; provider adoption values require the portable preparation path');
    const declaration = validateEdition(transaction.readFile(imported.observation, imported.definition).bytes);
    const projection = join(scratch, 'edition');
    transaction.materialize(imported.observation, imported.roots, projection);
    const soulRoot = join(projection, dirname(imported.definition)), body = join(soulRoot, 'AGENTS.md'), alias = join(soulRoot, 'CLAUDE.md');
    if (!lstatSync(body).isFile() || !lstatSync(alias).isSymbolicLink() || readlinkSync(alias) !== 'AGENTS.md'
        || readdirSync(soulRoot).some(name => !['soul.yaml', 'AGENTS.md', 'CLAUDE.md'].includes(name))) {
      throw oatsError('source-incomplete', 'classic setup edition must have canonical AGENTS.md/CLAUDE.md and no omitted private skill or knowledge trees');
    }
    return { declaration, instructions: readFileSync(body, 'utf8'), packageIntegrity: packageIntegrity(join(projection, 'oats-package')),
      source: { kind: 'exported-edition-copy', source: imported.reference.source, revision: imported.observation.source.commit,
        path: imported.reference.soul, workspaceRevision: view?.source.commit ?? null, captured: false } };
  } finally {
    transaction?.close();
    const current = lstatSync(scratch);
    if (!current.isDirectory() || current.dev !== owned.dev || current.ino !== owned.ino) throw oatsError('source-unavailable', 'setup source scratch ownership changed');
    rmSync(scratch, { recursive: true });
  }
}
