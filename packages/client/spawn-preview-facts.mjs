/** The facts a spawn preview shows, as data (#855, 6b-2): what the Desktop's spawn dialog draws in its preview
 * column (renderer/spawn-dialog.mjs `renderPreview`, `composePreviewModules`), for any client to draw in its own
 * way. Words about the preview only: no DOM, and nothing that names a client's controls.
 *
 * `previewFacts(data, { name, runsOn, cli })` for a preview projection (spawn-preview-contract.mjs `previewData`):
 *   identity  [{ label, text, title?, muted? }]: the Name (`name`, the client's own name field; without one the
 *             kernel numbers the instance, `muted`) and the Home (relative to the deployment, the full path as
 *             `title`)
 *   facts     [{ label, parts: [{ text, mono?, muted?, sub? }], harness? }]: Works in, Harness (with `harness`,
 *             the id a client may badge), Team, Relationship, Setup, Runs on (`runsOn`, the client's own words
 *             for the chosen deployment), in that order, each only when the preview says it. A part is plain
 *             text, `mono` (a branch), `muted`, or `sub` (a value's second line, muted: where it came from,
 *             what else)
 *   prompts   [{ label, text, mono? }] | null: the launch-prompt note, in the kernel contract's words
 *   warnings  [[line, …], …]: each capability warning's lines, every one (a client bounds what it shows,
 *             capability-warnings-contract.mjs `warningsShown`); [] when none
 *   modules   { core: [{ layer, label, module }], caps: [module] } | null: the core slots in their order (a
 *             `module` or null, an empty slot) and the other capabilities by name; each module is
 *             { name, source, why } (why '' when the preview does not say). null when the preview carries no
 *             `modules` (an older kernel: no placeholder).
 * `cli` is the CLI the preview was read with: it decides which launch facts the preview's `launch` may show. */
import { displayLine } from './display-text.mjs';
import { shownLaunch, launchHarnessName, launchFromText } from './launch-view.mjs';

/** The preview's work mode in words (board 6, "Works in"); an unknown mode verbatim. */
const WORK_PHRASES = Object.freeze({ __proto__: null, worktree: 'own worktree', checkout: 'shared checkout', attached: "a parent's worktree", directory: 'own folder · free to work across repos', workspace: 'all member repos' });
export const worksInText = work => WORK_PHRASES[work] ?? work;
/** The preview's home, short enough to read: relative to the deployment (the preview's subject.dir)
 * when it lies inside it, else its last three segments behind "…/". The full path is the title. */
export function homeText(home, dir) {
  if (typeof home !== 'string' || !home) return null;
  const base = typeof dir === 'string' && dir ? dir.replace(/\/+$/, '') : '';
  if (base && home.startsWith(`${base}/`) && home.length > base.length + 1) return { text: home.slice(base.length + 1), title: home };
  const parts = home.split('/').filter(Boolean);
  return { text: parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : home, title: home };
}
/** A worktree spawn's "Works in": the new branch (mono in the view) and the ref it starts from, when the preview says. */
export function worktreeText(data) {
  return { lead: 'worktree · branch ', branch: data.branch, tail: data.base?.ref ? ` from ${data.base.ref}` : '' };
}
/** The relation the preview binds, in words with its anchor ("child of api-2"); null when independent. */
const RELATION_WORDS = Object.freeze({ __proto__: null, child: 'child of', sibling: 'sibling of', parent: 'parent of' });
export function relationText(data) {
  const kind = data?.relation;
  if (typeof kind !== 'string' || !kind) return null;
  const anchor = data.decision?.effective?.relation?.anchor?.instance;
  if (!RELATION_WORDS[kind]) return kind;
  return typeof anchor === 'string' && anchor ? `${RELATION_WORDS[kind]} ${anchor}` : RELATION_WORDS[kind];
}
/** A preview module's source, as the Capabilities tag says it: the package and version, the member
 * repository, or the kind verbatim. Never a reason: that is moduleWhyText's, beside it. */
export function moduleSourceText(from) {
  if (from?.kind === 'package') return `package ${from.package ?? ''}${from.version ? ` ${from.version}` : ''}`.trimEnd();
  if (from?.kind === 'member') return `${String(from.repoKey ?? '').split('/').pop().replace(/\.git$/, '') || 'member'} · latest`;
  return typeof from?.kind === 'string' ? from.kind : '';
}
/** Why a preview module is there, as the reason tag beside its source says it: the projection's
 * `composedFrom` (feature preview-composed-from) — "Soul" or "Workspace default" (a core row already
 * names its slot). '' (no tag) when the preview does not say: an older CLI, or a value the projection
 * dropped. Never guessed from the soul. */
export function moduleWhyText(m) {
  if (m?.composedFrom === 'soul') return 'Soul';
  if (m?.composedFrom === 'workspace') return 'Workspace default';
  return '';
}
const CORE_SLOTS = Object.freeze([['knowledge', 'Knowledge'], ['messaging', 'Messaging'], ['tasks', 'Tasks']]);
const CORE_LAYERS = CORE_SLOTS.map(([layer]) => layer);
/** The preview's `modules` rows [{name, layer, from, composedFrom?}] as the core slots and the other
 * capabilities; null when the preview carries none. A module filling a core slot is the slot's only: never
 * among the others. */
function previewModules(modules) {
  if (!Array.isArray(modules)) return null;
  const rows = modules.filter(m => m && typeof m === 'object' && typeof m.name === 'string' && m.name);
  const described = m => ({ name: m.name, source: moduleSourceText(m.from), why: moduleWhyText(m) });
  const core = CORE_SLOTS.map(([layer, label]) => { const m = rows.find(x => x.layer === layer); return { layer, label, module: m ? described(m) : null }; });
  const caps = rows.filter(m => !CORE_LAYERS.includes(m.layer)).sort((a, b) => a.name.localeCompare(b.name)).map(described);
  return { core, caps };
}

/** `unnamed`: what the Name fact says with no name yet. Given (the dialog's 'named from its task', where it will ask the
 *  kernel for one, feature spawn-suggest-name), the preview's numbered name is not the one Spawn creates: the facts
 *  derived from it, the home and the new branch, are left out until there is a name. */
export function previewFacts(data, { name = null, runsOn = null, cli = null, unnamed } = {}) {
  const preview = data && typeof data === 'object' ? data : {};
  const pending = !name && unnamed !== undefined;
  const identity = [name ? { label: 'Name', text: name } : { label: 'Name', text: unnamed ?? 'numbered by the kernel', muted: true }];
  const home = pending ? null : homeText(preview.home, preview.subject?.dir);
  if (home) identity.push({ label: 'Home', text: home.text, title: home.title });
  const facts = [], fact = (label, parts, extra = {}) => { facts.push({ label, ...extra, parts }); };
  const worktree = preview.work === 'worktree' && preview.branch && !pending ? worktreeText(preview) : null;
  if (worktree) fact('Works in', [{ text: worktree.lead }, { text: worktree.branch, mono: true }, ...(worktree.tail ? [{ text: worktree.tail }] : [])]);
  else if (preview.work) fact('Works in', [{ text: worksInText(preview.work) }]);
  if (preview.harness) {
    // Where the harness came from: the Launch's `from` in words (0.30), else the kernel's modelSource verbatim.
    const launch = shownLaunch(preview.launch, cli);
    const from = launch ? launchFromText(launch.from) : preview.modelSource;
    fact('Harness', [{ text: `${launchHarnessName(preview.harness)} · ${preview.model ?? 'default model'}` }, ...(from ? [{ text: from, sub: true }] : [])], { harness: preview.harness });
  }
  // Team model v2: the default the kernel resolved (or none), then the other teams it may join. A 0.29 kernel reports only `team`, the primary label.
  const others = (preview.teams || []).map(t => t.label).filter(label => label !== preview.defaultTeam?.label);
  const also = others.length ? [{ text: `may also join ${others.join(', ')}`, sub: true }] : [];
  if (preview.defaultTeam) fact('Team', [{ text: preview.defaultTeam.label }, { text: ' · default', muted: true }, ...also]);
  else if (preview.defaultTeam === null && !(preview.teams?.length)) fact('Team', [{ text: 'none', muted: true }]);
  else if (preview.defaultTeam === undefined && typeof preview.team === 'string' && preview.team) fact('Team', [{ text: preview.team }]);
  const relation = relationText(preview);
  if (relation) fact('Relationship', [{ text: relation }]);
  // The capabilities whose `worktree` hook sets up ./work, in the order they run ([] or absent: none).
  const hooks = (preview.worktreeHooks ?? []).map(h => `${displayLine(h.capability) ?? ''}${h.required ? ' (required)' : ''}`);
  if (hooks.length) fact('Setup', [{ text: hooks.join(', ') }, { text: 'Runs after the worktree is made. Can take several minutes.', sub: true }]);
  if (runsOn) fact('Runs on', [{ text: runsOn }]);
  let prompts = null;
  if (preview.launchPromptAnswers) {
    // The launch-prompt policy is a note, not a fact: its words stay the kernel contract's, verbatim.
    const policy = preview.launchPromptAnswers;
    prompts = [{ label: 'Launch prompts', text: policy.awebDevelopmentChannel
      ? 'The launcher will answer the aweb development-channel confirmation for this home. This policy does not confirm readiness. A harness update can block the launch until its prompt fixtures are refreshed; no fallback key is sent.'
      : 'None. The launcher will not answer prompts for this home. This policy does not confirm readiness.' }];
    if (policy.consentSource) prompts.push({ label: 'Prompt consent source', text: policy.consentSource, mono: true });
  }
  // Capability warnings (0.49.0): the kernel's strings, each as its lines; they block nothing.
  const warnings = (Array.isArray(preview.warnings) ? preview.warnings : []).map(w => String(w).split('\n'));
  return { identity, facts, prompts, warnings, modules: previewModules(preview.modules) };
}
