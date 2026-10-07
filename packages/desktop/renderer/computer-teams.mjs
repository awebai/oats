/** The Workspace › Teams page (team model v2, OATS 0.30; spec docs/design/2026-09-27-team-model-v2.md,
 * option B; layout: the v4.1 Teams board). Two sections: the shared teams (the committed workspace,
 * read-only here: edited by PR) and the local ones (this computer's oats-local.yaml), one card per
 * team with its id, who may join it and (when the roster is given) the instances in it; the default
 * team (changeable); add or remove a local team. The document is the kernel's `oats teams --json`
 * result (K1's shapes, docs/desktop-cli-api.md "Team model v2"), read and changed through
 * `request(body)`: {action: 'list'} | {action: 'add', label, team, description?} |
 * {action: 'remove', label} | {action: 'default', label}, each answering the document after the
 * write. A refusal (E_TEAM_IN_USE, E_TEAM_EXISTS, …) is shown verbatim with its code. The page owns
 * its state, so the Teams tab mounts it once and keeps it across re-renders; `onDocument(doc)`
 * hears each document read (the tab's attention dot counts its problems). `readMembers()` answers
 * /api/team-members (packages/desktop/docs/desktop-teams.md): every instance of this workspace view's
 * deployments (#482: this Mac's and other machines') whose identity.team is a team's provider id, read on
 * mount and at each roster poll (`syncRoster`). A card lists its members by deployment, each headed by its
 * machine label; `onMember('open' | 'show', member)` opens one's terminal or selects its roster row
 * (`member.workspace` is its deployment id). Without the route the cards say nothing about them.
 *
 * Team model 3 (teamsApi 2, OATS 0.38; docs/design/2026-10-02-team-model-3.md): which teams a soul may join,
 * and its default, are the workspace's committed souls:, shown read only in their own section. Local teams
 * are this deployment's only where the workspace allows them (localTeams: true, or null in the standalone
 * view): then Add, Make default and Remove work as before. Where they are closed the kernel refuses add and
 * default before writing, so neither is offered; local teams still in oats-local.yaml keep Remove (the
 * kernel accepts it: the last step of committing them in the workspace), and the kernel's local-teams-closed
 * failure leads the page in its own words. The default says where it comes from (this deployment, or the
 * workspace's defaultTeam). Each card says whose default the team is and who else may join it, computed from
 * souls: alone (`teamAudience`; packages/desktop/docs/desktop-teams.md "The Teams board"). */
import { iconElement } from './shell-icons.mjs';
import { createSoulMark } from './identity-marks.mjs';
import { deploymentLabel, shortPath, THIS_MACHINE } from './deployment-label.mjs';

/** The Desktop's teams routes (#269, packages/desktop/docs/desktop-teams.md): `{status: 'ok',
 * teams}` (/api/workspace-teams) or `{status: 'ok', soulTeams}` (/api/workspace-soul-teams) answer
 * the decoded kernel document under `key`; `{status: 'refused', reason: {code, message}}` throws
 * the reason verbatim (the kernel's words, or the Desktop's own plain ones), with its code. */
export function teamsAnswer(answer, key, fallback) {
  const doc = answer?.status === 'ok' ? answer[key] : null;
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) return doc;
  const code = typeof answer?.reason?.code === 'string' ? answer.reason.code : null;
  const message = typeof answer?.reason?.message === 'string' && answer.reason.message ? answer.reason.message : fallback;
  throw Object.assign(new Error(message), { code });
}

/* Rule order matters twice: the cascade, and the contrast tests' computed styles (jsdom applies
 * matching rules in source order), so a state rule (.default, .none) follows its base. Focus is the
 * shell's (rule 2); a field's one frame is its wrapper (rule 3). */
export const computerTeamsCSS = `
/* The board is one wide column: wider than the tab's 760px list default (the page sits in the tab's body box). */
.workspace-discovery[data-tab=teams] > :has(> .computer-teams) { max-width:1120px; }
.computer-teams { display:flex; flex-direction:column; gap:18px; min-width:0; }
.computer-teams .ct-page-head { display:flex; align-items:flex-end; gap:16px; }
/* Pinned (spec G): 8px inside its edge, the page's 18px gap kept by pulling the next block up by 9px. */
.computer-teams .ct-page-head.ws-sticky { padding-bottom:8px; margin-bottom:-9px; }
.computer-teams .ct-title-wrap { display:flex; flex-direction:column; gap:4px; flex-grow:1; min-width:0; }
.computer-teams .ct-title { margin:0; color:var(--fg); font-size:17px; font-weight:700; line-height:1.3; }
.computer-teams .ct-lead { margin:0; color:var(--muted); font-size:12.5px; line-height:1.45; }
.computer-teams .ct-section { display:flex; flex-direction:column; gap:12px; min-width:0; }
/* Sections (and any problem above them) stack at the page's own gap, so the second section sits as far
   below the first as the first sits below the page head. */
.computer-teams .ct-body { display:flex; flex-direction:column; gap:18px; min-width:0; }
.computer-teams .ct-section-head { display:flex; align-items:center; gap:8px; }
.computer-teams .ct-section-title { margin:0; color:var(--muted); font-size:10.5px; font-weight:650; letter-spacing:.065em; text-transform:uppercase; }
.computer-teams .ct-scope { display:inline-flex; align-items:center; gap:5px; height:20px; padding:0 7px; border:1px solid var(--border); border-radius:5px; background:var(--surface); color:var(--muted); font-size:10.5px; font-weight:600; white-space:nowrap; }
.computer-teams .ct-scope.dashed { border:1px dashed var(--tree-line); }
.computer-teams .ct-card { display:grid; grid-template-columns:32px minmax(0,1fr) 240px; column-gap:14px; row-gap:10px; align-items:start; padding:16px 18px; background:var(--surface); border:1px solid var(--border); border-radius:10px; min-width:0; }
.computer-teams .ct-tile { display:grid; place-items:center; width:32px; height:32px; border-radius:8px; background:var(--chip-bg); color:var(--chip-fg); }
.computer-teams .ct-tile.default { background:var(--sel); color:var(--accent); }
.computer-teams .ct-main { display:flex; flex-direction:column; gap:6px; min-width:0; }
/* Nothing on the right (no members, no actions): the main column takes its width. */
.computer-teams .ct-card.no-side > .ct-main { grid-column:2 / -1; }
.computer-teams .ct-head { display:flex; align-items:center; flex-wrap:wrap; gap:6px 8px; min-width:0; }
.computer-teams .ct-label { color:var(--fg); font-size:14.5px; font-weight:650; line-height:1.3; overflow-wrap:anywhere; }
.computer-teams .ct-pill { display:inline-flex; align-items:center; padding:1px 7px; border-radius:10px; background:var(--sel); color:var(--accent); font-size:10.5px; font-weight:650; white-space:nowrap; }
.computer-teams .ct-desc { color:var(--fg); font-size:12.5px; line-height:1.45; overflow-wrap:anywhere; }
.computer-teams .ct-facts { display:flex; flex-wrap:wrap; gap:4px 18px; padding-top:4px; color:var(--muted); font-size:12px; line-height:1.45; }
.computer-teams .ct-fact { overflow-wrap:anywhere; }
.computer-teams .ct-id { color:var(--fg); font:12px var(--mono,monospace); }
.computer-teams .ct-id.none, .computer-teams .ct-warn { color:var(--warn); }
.computer-teams .ct-id.none { font-family:inherit; }
.computer-teams .ct-join { color:var(--fg); font-weight:600; }
.computer-teams .ct-join.none { color:var(--muted); font-weight:500; }
/* Team model 3: two labelled rows (Default for, May join), names bold; then the address, the quietest line. */
.computer-teams .ct-audience { display:grid; grid-template-columns:92px minmax(0,1fr); align-items:baseline; gap:3px 10px; margin:2px 0 0; min-width:0; font-size:12.5px; line-height:1.45; }
.computer-teams .ct-aud { display:contents; }
.computer-teams .ct-aud dt { color:var(--muted); font-size:12px; }
.computer-teams .ct-aud dd { margin:0; min-width:0; color:var(--fg); overflow-wrap:anywhere; }
.computer-teams .ct-aud[data-audience=join] dd, .computer-teams .ct-quiet { color:var(--muted); }
.computer-teams .ct-name { font-weight:650; }
.computer-teams .ct-address { color:var(--muted); font:11.5px var(--mono,monospace); overflow-wrap:anywhere; }
.computer-teams .ct-address.none { color:var(--warn); font-family:inherit; }
.computer-teams .ct-why { color:var(--muted); font-size:11.5px; line-height:1.45; overflow-wrap:anywhere; }
.computer-teams .ct-warn { font-size:11.5px; line-height:1.45; overflow-wrap:anywhere; }
.computer-teams .ct-blocking { display:flex; flex-direction:column; gap:2px; margin-top:4px; padding-left:8px; border-left:2px solid var(--danger); color:var(--muted); font-size:11.5px; line-height:1.45; overflow-wrap:anywhere; }
.computer-teams .ct-blocking strong { color:var(--fg); font-size:12px; font-weight:650; }
.computer-teams .ct-fix { display:block; color:var(--fg); font:11px var(--mono,monospace); overflow-wrap:anywhere; }
.computer-teams .ct-side { grid-column:3; display:flex; flex-direction:column; align-items:flex-end; gap:8px; min-width:0; }
.computer-teams .ct-inst { display:flex; align-items:center; gap:8px; }
.computer-teams .ct-marks { display:flex; }
.computer-teams .ct-marks .identity-mark { width:22px; height:22px; border-radius:6px; border:1.5px solid var(--surface); font-size:10px; font-weight:700; }
.computer-teams .ct-marks .identity-mark + .identity-mark { margin-left:-6px; }
.computer-teams .ct-count { color:var(--fg); font-size:12px; font-weight:600; white-space:nowrap; }
.computer-teams .ct-note { color:var(--muted); font-size:11.5px; line-height:1.45; text-align:right; }
.computer-teams .ct-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; }
.oats-view .computer-teams button.ct-act { height:26px; min-height:26px; padding:0 10px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--fg); font:600 11.5px var(--sans,system-ui); white-space:nowrap; cursor:pointer; }
.oats-view .computer-teams button.ct-act:hover:not(:disabled) { background:var(--surface-2); }
.oats-view .computer-teams button.ct-act:disabled { color:var(--muted); cursor:default; }
.oats-view .computer-teams button.ct-act.primary:not(:disabled) { background:var(--primary-bg); border-color:var(--primary-bg); color:var(--primary-fg); }
/* Where this deployment may not declare its own teams the head's Add is hidden: [hidden] wins over display. */
.oats-view .computer-teams button.ct-add[hidden] { display:none; }
.oats-view .computer-teams button.ct-add { display:inline-flex; align-items:center; gap:6px; flex:none; height:32px; min-height:32px; padding:0 12px; border-radius:7px; font-size:12.5px; }
.oats-view .computer-teams button.ct-link { height:auto; min-height:0; padding:0 4px; border:0; border-radius:4px; background:none; color:var(--accent); font-size:12.5px; }
.oats-view .computer-teams button.ct-link:hover:not(:disabled) { background:none; color:var(--fg); }
.computer-teams .ct-confirm, .computer-teams .ct-error { grid-column:1 / -1; }
.computer-teams .ct-confirm { display:flex; flex-direction:column; gap:8px; padding:8px 10px; border:1px solid var(--border); border-radius:7px; background:var(--surface-2); }
.computer-teams .ct-confirm p { margin:0; color:var(--fg); font-size:12px; line-height:1.45; }
.computer-teams .ct-error { border-left:2px solid var(--danger); padding-left:8px; color:var(--fg); font-size:12px; line-height:1.45; }
.computer-teams .ct-error p { margin:0; overflow-wrap:anywhere; }
.computer-teams .ct-error summary { color:var(--muted); font-size:11.5px; cursor:pointer; }
.computer-teams .ct-error pre { margin:4px 0 0; color:var(--fg); font:11px var(--mono,monospace); white-space:pre-wrap; overflow-wrap:anywhere; }
.computer-teams .ct-problem { padding:12px 18px; background:var(--surface); border:1px solid var(--border); border-radius:10px; }
.computer-teams .ct-empty { display:flex; align-items:center; gap:14px; padding:16px 18px; border:1px dashed var(--tree-line); border-radius:10px; color:var(--muted); font-size:12.5px; line-height:1.45; }
.computer-teams .ct-empty > span { flex-grow:1; overflow-wrap:anywhere; }
.computer-teams .ct-form { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.4fr); gap:10px; padding:16px 18px; background:var(--surface); border:1px solid var(--border); border-radius:10px; }
.computer-teams .ct-form label { display:flex; flex-direction:column; gap:3px; min-width:0; color:var(--muted); font-size:11.5px; }
.computer-teams .ct-form label.wide { grid-column:1 / -1; }
/* Rule 3: the field's one frame is the wrapper's; the input inside has none, in every state. */
.computer-teams .ct-field { display:flex; align-items:center; height:28px; min-width:0; border:1px solid var(--border); border-radius:6px; background:var(--surface); }
.computer-teams .ct-field:focus-within { border-color:var(--accent); }
.oats-view .computer-teams .ct-field input { flex:1 1 auto; min-width:0; height:100%; padding:0 8px; box-sizing:border-box; border:0; outline:none; box-shadow:none; background:transparent; color:var(--fg); font:12px var(--mono,monospace); }
.oats-view .computer-teams .ct-field input:focus, .oats-view .computer-teams .ct-field input:focus-visible { border:0; outline:none; box-shadow:none; }
.computer-teams .ct-form .ct-actions { grid-column:1 / -1; justify-content:flex-start; }
.computer-teams .ct-hint { grid-column:1 / -1; margin:0; color:var(--muted); font-size:11.5px; line-height:1.45; }
.computer-teams .ct-hint code { color:var(--fg); font:11px var(--mono,monospace); }
.computer-teams .ct-status { margin:0; color:var(--muted); font-size:12px; }
.computer-teams .ct-status:empty { display:none; }
/* Team model 3's souls: patterns, one row each: the pattern (monospace) and what it gives. */
.computer-teams .ct-soul-rules { display:flex; flex-direction:column; gap:0; margin:0; padding:4px 0; list-style:none; background:var(--surface); border:1px solid var(--border); border-radius:10px; min-width:0; }
.computer-teams .ct-soul-rule { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.4fr); gap:12px; padding:7px 18px; min-width:0; }
.computer-teams .ct-soul-rule + .ct-soul-rule { border-top:1px solid var(--border); }
.computer-teams .ct-soul-key { color:var(--fg); font:12px var(--mono,monospace); overflow-wrap:anywhere; }
.computer-teams .ct-soul-teams { color:var(--fg); font-size:12.5px; line-height:1.45; overflow-wrap:anywhere; }
/* The members (spec 02): grouped by machine, one row per instance with its state in words and two buttons. */
.computer-teams .ct-reach { margin:0; color:var(--muted); font-size:12px; line-height:1.45; overflow-wrap:anywhere; }
.computer-teams .ct-reach:empty { display:none; }
.computer-teams .ct-members-head { display:flex; align-items:center; gap:8px; margin-top:8px; color:var(--muted); font-size:10.5px; font-weight:650; letter-spacing:.065em; text-transform:uppercase; }
.computer-teams .ct-members-head::after { content:''; flex:1; border-top:1px solid var(--border); }
.computer-teams .ct-members { display:flex; flex-direction:column; gap:10px; margin:0; padding:0; list-style:none; min-width:0; }
.computer-teams .ct-group { display:flex; flex-direction:column; gap:4px; min-width:0; }
.computer-teams .ct-group-head { margin:0; color:var(--muted); font-size:12px; font-weight:500; line-height:1.45; overflow-wrap:anywhere; }
/* A group scans as a table: dot, name, soul mark, state word, Terminal, in columns shared by its rows (subgrid). */
.computer-teams .ct-member-list { display:grid; grid-template-columns:8px fit-content(220px) 18px fit-content(220px) auto; justify-content:start; column-gap:8px; row-gap:2px; margin:0; padding:0; list-style:none; min-width:0; }
.computer-teams .ct-member { display:grid; grid-column:1 / -1; grid-template-columns:subgrid; align-items:center; min-height:26px; min-width:0; }
.computer-teams .ct-member .identity-mark { width:18px; height:18px; border-radius:5px; font-size:9px; font-weight:700; flex:none; }
.computer-teams .ct-dot { box-sizing:border-box; width:8px; height:8px; flex:none; border-radius:50%; border:1.5px solid var(--faint); background:var(--surface); }
.computer-teams .ct-dot[data-state=running] { border-color:var(--accent); background:var(--accent); }
.computer-teams .ct-dot[data-state=unknown], .computer-teams .ct-dot[data-state=gone] { border-color:var(--warn); background:var(--warn); }
/* The name is the roster's (proportional, 12.5px/600) and shows the row: a text control, underlined on hover and focus. */
.oats-view .computer-teams .ct-member-name { appearance:none; justify-self:start; margin:0; padding:0; border:0; background:none; color:var(--fg); font:600 12.5px/1.3 var(--sans,system-ui); text-align:left; overflow-wrap:anywhere; min-width:0; cursor:pointer; }
.oats-view .computer-teams .ct-member-name:hover, .oats-view .computer-teams .ct-member-name:focus-visible { text-decoration:underline; }
.computer-teams .ct-member-state { min-width:0; color:var(--muted); font-size:11.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
/* Terminal: quiet, borderless until hover or focus. */
.oats-view .computer-teams .ct-member-term { appearance:none; display:inline-flex; align-items:center; gap:4px; flex:none; height:22px; padding:0 6px; border:1px solid transparent; border-radius:5px; background:none; color:var(--muted); font:600 11px var(--sans,system-ui); cursor:pointer; }
.oats-view .computer-teams .ct-member-term:hover, .oats-view .computer-teams .ct-member-term:focus-visible { border-color:var(--border); background:var(--surface-2); color:var(--fg); }
/* A narrow board: the actions and the member count move under the main column instead of squeezing it. */
@container (max-width: 640px) {
 .computer-teams .ct-card { grid-template-columns:32px minmax(0,1fr); }
 .computer-teams .ct-side { grid-column:2; align-items:flex-start; }
 .computer-teams .ct-side .ct-actions { justify-content:flex-start; }
 .computer-teams .ct-note { text-align:left; }
 /* The count repeats the "Members · N" head right above it. */
 .computer-teams .ct-side .ct-inst { display:none; }
}
`;

const text = v => typeof v === 'string' && v ? v : null;
const list = v => Array.isArray(v) ? v : [];
const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
/** The kernel's own clause for a workspace that closes local teams (lib/teams.mjs), and where a soul's teams
 * are changed in team model 3 (its removed-flag replacement): said in its words, never a second version. */
export const LOCAL_TEAMS_CLOSED = 'oats-workspace.yaml does not allow local teams (localTeams: true)';
export const SOULS_WHERE = 'souls: in oats-workspace.yaml (a PR to the workspace file)';
/** Team model 3's document (teamsApi 2). */
const model3 = d => d?.teamsApi === 2;
/** May this deployment declare its own teams? Always before team model 3; then where the workspace says so,
 * or in the standalone view (localTeams null). */
const localAllowed = d => !model3(d) || d.localTeams !== false;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function el(doc, tag, value, cls) {
  const node = doc.createElement(tag);
  if (value !== undefined && value !== null) node.textContent = value;
  if (cls) node.className = cls;
  return node;
}

/** Team model 3: how many souls: entries name a label (in teams, as its default, or `any` for a shared team).
 * "*" counts as one entry like the others: the most specific entry gives a soul's teams outright, so "*" is a
 * fallback, never a promise about every soul. */
function patternsOf(document, label) {
  const shared = list(document?.teams).some(t => t.label === label && t.from === 'shared');
  const names = rule => rule.default === label || (rule.teams === 'any' ? shared : list(rule.teams).includes(label));
  return record(document?.souls) ? Object.values(document.souls).filter(rule => record(rule) && names(rule)).length : 0;
}
/** The souls a label is declared for, as the document says: every soul (souls.teams['*']), or the
 * soul keys naming it in souls.teams and souls.default (the same soul counted once). */
function soulsOf(document, label) {
  const teams = document?.souls?.teams && typeof document.souls.teams === 'object' ? document.souls.teams : {};
  const defaults = document?.souls?.default && typeof document.souls.default === 'object' ? document.souls.default : {};
  const every = list(teams['*']).includes(label);
  const souls = new Set([...Object.entries(teams).filter(([key, labels]) => key !== '*' && list(labels).includes(label)).map(([key]) => key),
    ...Object.entries(defaults).filter(([, value]) => value === label).map(([key]) => key)]);
  return { every, souls };
}

/** What still references a label in the document (defaultTeam, souls.teams, souls.default):
 * the reason Remove is off, in words. The kernel's own refusal (E_TEAM_IN_USE) stays the authority. */
export function teamInUse(document, label) {
  const reasons = [];
  // Team model 3: only this deployment's own default (oats-local.yaml defaultTeam) keeps a local team;
  // souls: name shared labels only.
  if (model3(document)) return document.defaultTeam?.from === 'deployment' && document.defaultTeam.label === label
    ? "Can't remove: it is the default team. Change that first." : null;
  if (document?.defaultTeam === label) reasons.push('it is the default team');
  const { every, souls } = soulsOf(document, label);
  if (every) reasons.push('every soul may join it');
  if (souls.size) reasons.push(`${plural(souls.size, 'soul')} use${souls.size === 1 ? 's' : ''} it`);
  return reasons.length ? `Can't remove: ${reasons.join('; ')}. Change that first.` : null;
}

/** A souls: key's place in the pattern order: "*" (level 0), `<repo-or-package>/*` (1), `<repo-or-package>/<soul>`
 * (2), split as the kernel does (lib/teams.mjs patternsOf: the last "/"); anything else is ignored. */
function soulKey(key) {
  if (key === '*') return { key, level: 0, repo: null, soul: null };
  const at = key.lastIndexOf('/');
  if (at <= 0 || at === key.length - 1) return null;
  const repo = key.slice(0, at), soul = key.slice(at + 1);
  return soul === '*' ? { key, level: 1, repo, soul: null } : { key, level: 2, repo, soul };
}
const AUDIENCE_ORDER = ['every', 'fallback', 'local', 'repo', 'soul'];
const byAudience = (a, b) => AUDIENCE_ORDER.indexOf(a.kind) - AUDIENCE_ORDER.indexOf(b.kind)
  || codePoint(a.repo ?? '', b.repo ?? '') || codePoint(a.soul ?? '', b.soul ?? '');
const audienceEntry = ({ key, level, repo, soul }) => level === 0 ? { kind: 'every', key } : level === 1 ? { kind: 'repo', key, repo } : { kind: 'soul', key, repo, soul };

/** Team model 3 (teamsApi 2): whose default a team is, and who else may join it, from the committed souls: map
 * alone (docs/design/2026-10-02-team-model-3.md: a soul's teams come from its most specific key, its default
 * from the most specific key that sets one; `any` is every shared team). → `{ defaultFor, mayJoin }`, each a
 * list of `{ kind: 'every' | 'fallback' | 'local' | 'repo' | 'soul', key?, repo?, soul?, except? }`:
 *   - defaultFor: each key whose default is the label (`"*"` every soul, `<p>/*` all souls of p, `<p>/<s>` soul s
 *     of p), less the keys a broader one already implies (the nearest broader key that sets a default gives the
 *     same); `except` names the more specific keys under it that set another default. Plus `fallback` when the
 *     label is the document's defaultTeam (every soul without a souls: default; `from` says whose, `nobody`
 *     when "*" sets a default and so no soul falls back);
 *   - mayJoin: each key whose teams include the label (or `any`, for a shared team) and whose souls do not
 *     already have it as their default, less the keys their nearest broader key already covers; `except` names
 *     the more specific keys under it whose souls may not join. A local team where local teams are allowed:
 *     `local` (every soul).
 * Each list: every/fallback/local first, then repos, then souls, by code point. Null before team model 3. */
export function teamAudience(document, label) {
  if (!model3(document)) return null;
  const rules = new Map();
  for (const [key, rule] of record(document.souls) ? Object.entries(document.souls) : []) {
    const at = soulKey(key);
    if (at && record(rule)) rules.set(key, { ...at, rule });
  }
  const shared = list(document.teams).some(t => t.label === label && t.from === 'shared');
  /** The broader keys that exist, nearest first (the kernel's pattern order). */
  const broader = k => (k.level === 2 ? [`${k.repo}/*`, '*'] : k.level === 1 ? ['*'] : []).map(key => rules.get(key)).filter(Boolean);
  const under = (k, top) => top.level === 0 ? k.level > 0 : top.level === 1 && k.level === 2 && k.repo === top.repo;
  const setsDefault = k => !!text(k.rule.default);
  const ownDefault = k => [k, ...broader(k)].find(setsDefault)?.rule.default ?? null;
  const lists = k => k.rule.teams === 'any' ? shared : list(k.rule.teams).includes(label);
  const sorted = entries => entries.sort(byAudience);
  /** The keys under `top` that `out` (their souls are not in its audience) and whose nearest broader key
   * (`nearest`) is `top`, or a key under it whose souls are (`inside`). */
  const exceptions = (top, out, nearest, inside) => sorted([...rules.values()].filter(d => {
    if (!under(d, top) || !out(d)) return false;
    const n = nearest(d);
    return n === top || (!!n && under(n, top) && inside(n));
  }).map(audienceEntry));

  // Default for: implied when the nearest broader key that sets a default gives the same one.
  const defaultFor = [];
  for (const k of rules.values()) {
    if (k.rule.default !== label) continue;
    const above = broader(k).find(setsDefault);
    if (above?.rule.default === label) continue;
    const except = exceptions(k, d => setsDefault(d) && d.rule.default !== label, d => broader(d).find(setsDefault), n => n.rule.default === label);
    defaultFor.push({ ...audienceEntry(k), ...(except.length ? { except } : {}) });
  }
  if (document.defaultTeam?.label === label) {
    const star = rules.get('*');
    defaultFor.push({ kind: 'fallback', from: document.defaultTeam.from === 'deployment' ? 'deployment' : 'workspace', ...(star && setsDefault(star) ? { nobody: true } : {}) });
  }

  // May join: the keys that list it for souls it is not already the default of; one is implied when its nearest
  // broader key (the one its souls would fall to) is itself shown.
  const shown = k => lists(k) && ownDefault(k) !== label;
  const canJoin = k => lists(k) || ownDefault(k) === label;
  const mayJoin = [];
  for (const k of rules.values()) {
    if (!shown(k)) continue;
    const above = broader(k)[0];
    if (above && shown(above)) continue;
    const except = exceptions(k, d => !canJoin(d), d => broader(d)[0], canJoin);
    mayJoin.push({ ...audienceEntry(k), ...(except.length ? { except } : {}) });
  }
  if (list(document.teams).some(t => t.label === label && t.from === 'local') && localAllowed(document)) mayJoin.push({ kind: 'local' });
  return { defaultFor: sorted(defaultFor), mayJoin: sorted(mayJoin) };
}

/** A card's "Who may join" value: 'every soul', 'N souls', or null when no soul is declared for it yet. */
export function whoMayJoin(document, label) {
  if (model3(document)) {
    // A local team where local teams are allowed: every soul may join it (via local).
    if (list(document.teams).some(t => t.label === label && t.from === 'local') && localAllowed(document)) return 'every soul';
    const entries = patternsOf(document, label);
    const fallback = document.defaultTeam?.label === label ? 'souls without their own default' : null;
    return [fallback, entries ? `${entries} ${entries === 1 ? 'entry' : 'entries'} in souls:` : null].filter(Boolean).join(' · ') || null;
  }
  const { every, souls } = soulsOf(document, label);
  return every ? 'every soul' : souls.size ? plural(souls.size, 'soul') : null;
}

const MAX_MARKS = 3;

const codePoint = (a, b) => a < b ? -1 : a > b ? 1 : 0;
/** A member's state in words (never colour alone): running, stopped, unknown, or gone from its server. */
export const memberState = m => m.missingRemotely ? 'gone' : m.running === true ? 'running' : m.running === false ? 'stopped' : 'unknown';
/** The state word on a member row: running when it can be opened; else the roster's short reason
 * ("gone from X", "not reachable on X", "X not reached"), else stopped or unknown. */
export function stateWord(m) {
  if (m.running === true && m.addressable === true) return 'running';
  return text(m.reasonLabel) && m.reasonLabel !== 'state unknown' ? m.reasonLabel : memberState(m);
}
/** Why a member's terminal can't be opened: the roster's own reason (the route sends it), or, for a
 * stopped member the roster has no reason for, that it is not running. Null when it can be opened. */
export function openBlocked(m) {
  if (m.running === true && m.addressable === true) return null;
  return text(m.reason) ?? `${m.instance} is not running.`;
}
/** A member's deployment (#482: `{id, machine, path}`, its `workspace` is that id), or null from an older route. */
const memberDeployment = m => m.deployment && typeof m.deployment === 'object' && text(m.deployment.id) ? m.deployment : null;
/** Members by deployment (#482), each headed by its machine label ("This Mac · ~/Agents/oats", "altair ·
 * ~/Agents/tsm"): this computer's first, then the other machines by label (code points), the server id, then the
 * deployment id breaking ties; within one, by instance name, then home. An answer without deployments (an older
 * route) groups by machine: "This computer", then each server. A group is not reached when every roster group its
 * members come from failed its last read; when only some did (an edited registration keeps its old group), the
 * heading stays reached and those members' own state ("unknown") and reason carry it. */
export function memberGroups(members, servers = []) {
  const byGroup = new Map(list(servers).map(s => [`remote:${s.group}`, s]));
  for (const s of list(servers)) if (text(s.deployment)) byGroup.set(s.deployment, s);
  const groups = new Map();
  for (const m of members) {
    const deployment = memberDeployment(m), key = deployment ? `deployment:${deployment.id}` : m.server ?? '';
    const label = deployment ? deploymentLabel({ machine: text(deployment.machine) ?? (m.server ? text(m.serverLabel) ?? m.server : THIS_MACHINE), label: shortPath(deployment.path) })
      : m.server ? text(m.serverLabel) ?? m.server : 'This computer';
    if (!groups.has(key)) groups.set(key, { key, server: m.server ?? null, deployment: deployment?.id ?? null, label, reached: true, error: null, members: [], sources: new Map() });
    const group = groups.get(key), source = m.server ? byGroup.get(m.workspace) : null;
    if (source) group.sources.set(source.group, source);
    group.members.push(m);
  }
  for (const group of groups.values()) {
    const sources = [...group.sources.values()];
    if (sources.length && sources.every(s => !s.reached)) { group.reached = false; group.error = text(sources[0].error); }
    delete group.sources;
  }
  for (const group of groups.values()) group.members.sort((a, b) => codePoint(a.instance, b.instance) || codePoint(a.home, b.home));
  return [...groups.values()].sort((a, b) => (a.server === null) !== (b.server === null) ? (a.server === null ? -1 : 1)
    : codePoint(a.label, b.label) || codePoint(a.server ?? '', b.server ?? '') || codePoint(a.deployment ?? '', b.deployment ?? ''));
}
/** The card's summary: "N members", with "· M on other machines" when some run elsewhere; nothing for none. */
export function memberSummary(members) {
  if (!members.length) return null;
  const elsewhere = members.filter(m => m.server).length;
  return `${plural(members.length, 'member')}${elsewhere ? ` · ${elsewhere} on other machines` : ''}`;
}
/** The route's answer, kept only as far as it validates (every string still enters the DOM by assignment). */
function membersAnswer(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.members)) return null;
  // A member's deployment (#482), when sent, is `{id, machine, path}` of strings and its id is the member's `workspace`.
  const members = v.members.filter(m => m && typeof m === 'object' && text(m.instance) && text(m.home) && text(m.team) && text(m.workspace)
    && (m.server === null || text(m.server))
    && (m.deployment === undefined || m.deployment && typeof m.deployment === 'object' && m.deployment.id === m.workspace
      && typeof m.deployment.machine === 'string' && typeof m.deployment.path === 'string'));
  return { members, servers: list(v.servers).filter(s => s && typeof s === 'object' && text(s.group)),
    notReached: list(v.notReached).filter(s => s && typeof s === 'object' && text(s.label)) };
}

export function createComputerTeams(doc, { request, onDocument = null, readMembers = null, onMember = () => {} }) {
  const page = el(doc, 'section', null, 'computer-teams'); page.dataset.box = 'Teams'; page.setAttribute('aria-label', 'Teams');
  const status = el(doc, 'p', '', 'ct-status'); status.setAttribute('role', 'status');
  // Servers we hold no rows for yet: said under the head, and kept current as they answer (outside the redraw barrier).
  const reach = el(doc, 'p', '', 'ct-reach'); reach.setAttribute('role', 'status');
  let roster = null, rosterSerial = 0, groupIds = 0;
  const body = el(doc, 'div', null, 'ct-body');
  let current = null, pending = false, serial = 0, disposed = false;
  let rowError = null, cardError = null, confirming = null, adding = false, opener = 'head';
  const draft = { label: '', team: '', description: '' };

  // The page head is static: the title, its one line, and the add button (the form opens below,
  // in "Only on this computer"). Opened twice, the button only brings the focus back to the form.
  // The head stays pinned while the page scrolls (spec G: .ws-sticky, discoveryCSS and sticky-top.mjs).
  const head = el(doc, 'div', null, 'ct-page-head ws-sticky'), titles = el(doc, 'div', null, 'ct-title-wrap');
  titles.append(el(doc, 'h2', 'Teams', 'ct-title'), el(doc, 'p', 'Who your agents can message. A team never adds capabilities or restricts what a soul can do.', 'ct-lead'));
  const addButton = el(doc, 'button', null, 'ct-act ct-add'); addButton.type = 'button';
  addButton.append(iconElement(doc, 'plus', { size: 13 }), el(doc, 'span', 'Add a local team'));
  addButton.setAttribute('aria-expanded', 'false');
  addButton.addEventListener('click', () => { if (addButton.disabled) return; openAdd('head'); });
  head.append(titles, addButton);
  page.append(head, reach, status, body);

  function openAdd(from) {
    opener = from;
    if (adding) { focusIn('.ct-form input[name=label]'); return; }
    adding = true; cardError = null; render();
  }

  async function run(action, { label = null } = {}) {
    const ticket = ++serial; pending = true; rowError = null; cardError = null; render();
    try {
      const next = await request(action);
      if (disposed || ticket !== serial) return;
      pending = false;
      if (!next || !Array.isArray(next.teams)) { cardError = { message: 'The teams on this computer could not be read.' }; render(); return; }
      current = next;
      if (action.action === 'add') { adding = false; Object.assign(draft, { label: '', team: '', description: '' }); }
      if (action.action === 'default') confirming = null;
      status.textContent = ''; render();
      onDocument?.(current);
    } catch (error) {
      if (disposed || ticket !== serial) return;
      pending = false;
      const shown = { code: text(error?.code), message: text(error?.message) || 'The change was refused.' };
      if (label && action.action !== 'add') rowError = { label, ...shown }; else cardError = shown;
      render();
    }
  }
  const read = () => run({ action: 'list' });

  function problemBox(error) {
    const wrap = el(doc, 'div', null, 'ct-error'); wrap.setAttribute('role', 'alert');
    wrap.append(el(doc, 'p', error.message));
    if (error.code) { const more = el(doc, 'details'); more.append(el(doc, 'summary', 'Details'), el(doc, 'pre', error.code)); wrap.append(more); }
    return wrap;
  }
  function button(label, cls, onClick, { disabled = false, title = '', aria = '' } = {}) {
    const b = el(doc, 'button', label, `ct-act${cls ? ` ${cls}` : ''}`); b.type = 'button';
    b.disabled = disabled || pending; if (title) b.title = title; if (aria) b.setAttribute('aria-label', aria);
    b.addEventListener('click', () => { if (!b.disabled) onClick(); });
    return b;
  }
  function kernelProblem(problem) {
    // The default team's problem blocks every spawn here (the kernel's `default: true`): said as such.
    // Any other failure (team model 3's local-teams-closed) is the kernel's words, as an alert.
    const blocking = problem.default === true && text(problem.label), failure = blocking || problem.severity === 'failure';
    const line = el(doc, 'div', null, failure ? 'ct-blocking' : 'ct-warn'); line.dataset.problem = problem.code || '';
    if (failure) line.setAttribute('role', 'alert');
    if (blocking) line.append(el(doc, 'strong', `The default team ${problem.label} has no provider id yet: nothing can be spawned until it has one.`));
    line.append(el(doc, 'span', problem.message || problem.code || 'A problem was reported.'));
    // A kernel message that already ends with its fix (local-teams-closed) says it once.
    if (text(problem.fix) && !(problem.message ?? '').includes(problem.fix)) line.append(el(doc, 'span', problem.fix, 'ct-fix'));
    if (blocking) line.append(el(doc, 'span', 'Or make another team the default.', 'ct-why'));
    return line;
  }

  /** A team's members, wherever they run: its provider id is their identity's team. An unmapped team has none. */
  function membersOf(team) {
    if (!text(team.team) || !roster) return [];
    return roster.members.filter(m => m.team === team.team);
  }
  /** One member: its dot, its name (which shows its roster row), its soul mark, its state in words and, only
   * when it can be opened, a quiet Terminal. A member that can't be opened says why in its state word. */
  function memberRow(m) {
    const item = el(doc, 'li', null, 'ct-member'), machine = m.server ? text(m.deployment?.machine) ?? text(m.serverLabel) ?? m.server : 'this computer';
    const dot = el(doc, 'span', null, 'ct-dot'); dot.dataset.state = memberState(m); dot.setAttribute('aria-hidden', 'true');
    const name = el(doc, 'button', m.instance, 'ct-member-name'); name.type = 'button'; name.setAttribute('aria-label', `Show ${m.instance} in the roster`);
    name.addEventListener('click', () => onMember('show', { ...m }));
    const word = el(doc, 'span', stateWord(m), 'ct-member-state'), blocked = openBlocked(m);
    if (blocked) { word.title = blocked; word.setAttribute('aria-description', blocked); }
    item.append(dot, name, createSoulMark(doc, { name: m.agent, agentsRoot: m.agentsRoot }), word);
    if (!blocked) {
      const term = el(doc, 'button', null, 'ct-member-term'); term.type = 'button'; term.setAttribute('aria-label', `Open ${m.instance} terminal on ${machine}`);
      term.append(iconElement(doc, 'terminal', { size: 12 }), el(doc, 'span', 'Terminal'));
      term.addEventListener('click', () => onMember('open', { ...m }));
      item.append(term);
    }
    return item;
  }
  function memberList(members) {
    const groups = el(doc, 'ul', null, 'ct-members'), labelId = `ct-members-${++groupIds}`;
    // "Members · N" over a hairline: the list's label.
    const label = el(doc, 'div', `Members · ${members.length}`, 'ct-members-head'); label.id = labelId;
    groups.setAttribute('aria-labelledby', labelId);
    for (const group of memberGroups(members, roster?.servers)) {
      const item = el(doc, 'li', null, 'ct-group'), id = `ct-group-${++groupIds}`;
      item.setAttribute('role', 'group'); item.setAttribute('aria-labelledby', id);
      const head = el(doc, 'h4', `${group.label} · ${group.reached ? group.members.length : 'not reached'}`, 'ct-group-head'); head.id = id;
      if (!group.reached && group.error) head.title = group.error;
      const rows = el(doc, 'ul', null, 'ct-member-list');
      for (const m of group.members) rows.append(memberRow(m));
      item.append(head, rows); groups.append(item);
    }
    return [label, groups];
  }

  /** Team model 3's two labelled rows (only those with entries), or "No soul may join it yet". Names are bold,
   * each with its souls: key as its title; every string enters by assignment. */
  function audienceFacts({ defaultFor, mayJoin }) {
    if (!defaultFor.length && !mayJoin.length) return el(doc, 'span', 'No soul may join it yet', 'ct-join none');
    const rows = el(doc, 'dl', null, 'ct-audience');
    const name = entry => { const b = el(doc, 'b', entry.kind === 'soul' ? entry.soul : entry.repo, 'ct-name'); b.title = entry.key; return [b]; };
    const soul = entry => [...name(entry), ` (${entry.repo})`];
    const series = (items, nodes) => items.flatMap((item, i) => [...(i ? [i === items.length - 1 ? ' and ' : ', '] : []), ...nodes(item)]);
    /** What "every soul" leaves out: the repos as one series ("souls of p and q"), then each soul. */
    const everyBut = except => {
      const repos = except.filter(x => x.kind === 'repo'), groups = except.filter(x => x.kind === 'soul').map(soul);
      if (repos.length) groups.unshift(['souls of ', ...series(repos, name)]);
      return series(groups, nodes => nodes);
    };
    const phrase = (entries, may) => {
      const parts = [], plainRepos = entries.filter(e => e.kind === 'repo' && !e.except), souls = entries.filter(e => e.kind === 'soul');
      const ofRepo = may ? 'souls of ' : 'all souls of ';
      for (const e of entries) {
        if (e.kind === 'every') parts.push(['every soul', ...(e.except ? [' except ', ...everyBut(e.except)] : [])]);
        else if (e.kind === 'fallback') parts.push(e.nobody ? [el(doc, 'span', 'fallback; every soul has its own default', 'ct-quiet')]
          : [`every soul without its own default${e.from === 'deployment' ? " (this deployment's choice)" : ''}`]);
        else if (e.kind === 'local') parts.push(['every soul (local team)']);
        else if (e.kind === 'repo' && e.except) parts.push([ofRepo, ...name(e), ' except ', ...series(e.except, name)]);
        // The repos without exceptions read as one series ("souls of a, b and c"), as do the single souls.
        else if (e === plainRepos[0]) parts.push([ofRepo, ...series(plainRepos, name)]);
        else if (e === souls[0]) parts.push(series(souls, soul));
      }
      return parts.flatMap((nodes, i) => [...(i ? [' · '] : []), ...nodes]);
    };
    const row = (key, caption, entries, may) => {
      if (!entries.length) return;
      const item = el(doc, 'div', null, 'ct-aud'); item.dataset.audience = key;
      const value = el(doc, 'dd'); value.append(...phrase(entries, may));
      item.append(el(doc, 'dt', caption), value); rows.append(item);
    };
    row('default', 'Default for', defaultFor, false);
    row('join', 'May join', mayJoin, true);
    return rows;
  }

  function teamCard(team) {
    const card = el(doc, 'article', null, 'ct-card'); card.dataset.team = team.label; card.dataset.from = team.from;
    if (team.default) card.dataset.default = 'true';
    // The tile: the board's users glyph.
    const tile = el(doc, 'span', null, `ct-tile${team.default ? ' default' : ''}`); tile.setAttribute('aria-hidden', 'true');
    tile.append(iconElement(doc, 'users', { size: 16 }));
    const main = el(doc, 'div', null, 'ct-main'), head = el(doc, 'div', null, 'ct-head');
    head.append(el(doc, 'span', team.label, 'ct-label'));
    if (team.default) head.append(el(doc, 'span', !model3(current) ? 'Default on this computer'
      : current.defaultTeam?.from === 'workspace' ? "Default · the workspace's" : 'Default · this deployment', 'ct-pill'));
    main.append(head);
    if (text(team.description)) main.append(el(doc, 'span', team.description, 'ct-desc'));
    const problems = list(current.problems).filter(p => p?.label === team.label), blocks = p => p.default === true || p.severity === 'failure';
    const audience = teamAudience(current, team.label);
    if (audience) {
      // Team model 3: what blocks comes first, then whose default it is and who else may join, then the
      // address (the quietest line), then the team's warnings.
      for (const problem of problems.filter(blocks)) main.append(kernelProblem(problem));
      main.append(audienceFacts(audience));
      const address = el(doc, 'span', team.team ?? 'no provider id yet', `ct-address${team.team ? '' : ' none'}`);
      address.title = 'Address: the team on the messaging provider'; main.append(address);
      for (const problem of problems.filter(p => !blocks(p))) main.append(kernelProblem(problem));
    } else {
      const facts = el(doc, 'div', null, 'ct-facts');
      const address = el(doc, 'span', 'Address ', 'ct-fact'); address.append(el(doc, 'span', team.team ?? 'no provider id yet', `ct-id${team.team ? '' : ' none'}`));
      const join = el(doc, 'span', 'Who may join ', 'ct-fact'), who = whoMayJoin(current, team.label);
      join.append(el(doc, 'b', who ?? 'No soul yet', `ct-join${who ? '' : ' none'}`));
      facts.append(address, join); main.append(facts);
      for (const problem of problems) main.append(kernelProblem(problem));
    }
    const actions = el(doc, 'div', null, 'ct-actions');
    // Make default writes oats-local.yaml's defaultTeam: only where this deployment may declare it.
    if (!team.default && localAllowed(current)) actions.append(button('Make default', '', () => { confirming = team.label; render(); focusIn(`[data-team="${team.label}"] .ct-confirm .primary`); },
      { disabled: !team.team, title: team.team ? '' : 'A team with no provider id yet cannot be the default.', aria: `Make ${team.label} the default team` }));
    if (team.from === 'local') {
      const why = teamInUse(current, team.label);
      actions.append(button('Remove', '', () => run({ action: 'remove', label: team.label }, { label: team.label }),
        { disabled: !!why, title: why || '', aria: why ? `Remove ${team.label}: ${why}` : `Remove ${team.label}` }));
      if (why) main.append(el(doc, 'span', why, 'ct-why'));
    }
    // The members come last in the main column: below the facts and the card's own notes (problems, why Remove is off).
    const members = membersOf(team);
    if (members.length) main.append(...memberList(members));
    card.append(tile, main);
    // The right column says who is in the team only when the roster shows someone; never a zero.
    const side = el(doc, 'div', null, 'ct-side');
    if (members.length) {
      const line = el(doc, 'div', null, 'ct-inst'), marks = el(doc, 'span', null, 'ct-marks');
      for (const row of members.slice(0, MAX_MARKS)) marks.append(createSoulMark(doc, { name: row.agent, agentsRoot: row.agentsRoot }));
      line.append(marks, el(doc, 'span', memberSummary(members), 'ct-count'));
      side.append(line);
      if (team.default) side.append(el(doc, 'span', 'every instance joins its default team', 'ct-note'));
    }
    if (actions.childElementCount) side.append(actions);
    if (side.childElementCount) card.append(side); else card.classList.add('no-side');
    if (confirming === team.label) {
      const confirm = el(doc, 'div', null, 'ct-confirm');
      confirm.append(el(doc, 'p', `Make ${team.label} the default team on this computer? Running instances keep their current default team until they are respawned.`));
      const buttons = el(doc, 'div', null, 'ct-actions');
      buttons.append(button('Make default', 'primary', () => run({ action: 'default', label: team.label }, { label: team.label })),
        button('Cancel', '', () => { confirming = null; render(); focusIn(`[data-team="${team.label}"] .ct-side .ct-actions button`); }));
      confirm.append(buttons); card.append(confirm);
    }
    if (rowError?.label === team.label) card.append(problemBox(rowError));
    return card;
  }

  function addForm() {
    const form = el(doc, 'form', null, 'ct-form'); form.noValidate = true; form.setAttribute('aria-label', 'Add a local team');
    const field = (name, caption, placeholder, cls = '') => {
      const label = el(doc, 'label', caption, cls), wrap = el(doc, 'span', null, 'ct-field'), input = el(doc, 'input');
      input.name = name; input.value = draft[name]; input.placeholder = placeholder; input.autocomplete = 'off'; input.spellcheck = false;
      input.addEventListener('input', () => { draft[name] = input.value; });
      wrap.append(input); label.append(wrap); form.append(label); return input;
    };
    const first = field('label', 'Label', 'mine'); field('team', 'Team id', 'mine:you.aweb.ai'); field('description', 'Description (optional)', '', 'wide');
    const actions = el(doc, 'div', null, 'ct-actions');
    const submit = button('Add team', 'primary', () => {});
    submit.type = 'submit'; submit.disabled = pending;
    actions.append(submit, button('Cancel', '', () => { adding = false; cardError = null; render(); focusIn(opener === 'link' ? '.ct-empty .ct-link' : '.ct-add'); }));
    const hint = el(doc, 'p', null, 'ct-hint'); hint.append('To create a new team, run ', el(doc, 'code', 'oats aweb setup'), '.');
    form.append(actions, hint);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const label = draft.label.trim(), team = draft.team.trim(), description = draft.description.trim();
      if (!label || !team) { cardError = { message: 'A local team needs a label and its provider team id.' }; render(); return; }
      // The kernel's label grammar (lowercase only); said here instead of a bare E_BAD_ARGS from the route.
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(label)) { cardError = { message: 'A label is lowercase letters and digits, with . _ or - after the first character.' }; render(); return; }
      void run({ action: 'add', label, team, ...(description ? { description } : {}) });
    });
    queueMicrotask(() => { if (first.isConnected && !first.value) first.focus(); });
    return form;
  }

  function section(name, titleText, scopeText, dashed) {
    const wrap = el(doc, 'section', null, 'ct-section'); wrap.dataset.section = name;
    const head = el(doc, 'div', null, 'ct-section-head');
    head.append(el(doc, 'h3', titleText, 'ct-section-title'), el(doc, 'span', scopeText, `ct-scope${dashed ? ' dashed' : ''}`));
    wrap.setAttribute('aria-label', titleText); wrap.append(head);
    return wrap;
  }
  function emptyCard(message) { const card = el(doc, 'div', null, 'ct-empty'); card.append(el(doc, 'span', message)); return card; }
  /** Team model 3: the workspace's souls: patterns as committed, read only: each pattern's default and the
   * other teams its souls may join (`any`: every shared team). */
  function soulsSection() {
    const wrap = section('souls', 'Souls in the workspace', 'Shared · Git', false);
    wrap.append(el(doc, 'p', `Which teams each soul may join, and its default: ${SOULS_WHERE}.`, 'ct-lead'));
    const rules = record(current.souls) ? Object.entries(current.souls) : [];
    if (!rules.length) {
      // With local teams allowed, every soul may also join each of this deployment's local teams (via local).
      const local = localAllowed(current) && list(current.teams).some(t => t.from === 'local');
      wrap.append(emptyCard(`No souls: entries: a soul may join its default team${local ? " and this deployment's local teams" : ' only'}.`));
      return wrap;
    }
    const table = el(doc, 'ul', null, 'ct-soul-rules');
    for (const [key, rule] of rules) {
      // "default a · may also join b, c" (any: every shared team); the default is not said twice.
      const others = rule.teams === 'any' ? 'any shared team' : list(rule.teams).filter(l => l !== rule.default).join(', ');
      const parts = [...(text(rule.default) ? [`default ${rule.default}`] : []), ...(others ? [`may ${text(rule.default) ? 'also ' : ''}join ${others}`] : [])];
      const row = el(doc, 'li', null, 'ct-soul-rule');
      row.append(el(doc, 'span', key, 'ct-soul-key'), el(doc, 'span', parts.join(' · ') || 'no other team', 'ct-soul-teams'));
      table.append(row);
    }
    wrap.append(table);
    return wrap;
  }

  // Who is in each team, as drawn: a roster poll that changes it redraws the cards (syncRoster).
  let rosterDrawn = '';
  const rosterKey = () => JSON.stringify([list(current?.teams).map(team => membersOf(team).map(m => [m.server, m.home, m.instance, m.agent, m.agentsRoot,
    m.running, m.addressable, m.missingRemotely, m.reason])), list(roster?.servers).map(s => [s.group, s.reached, s.error])]);
  function render() {
    if (disposed) return;
    body.replaceChildren();
    addButton.disabled = pending; addButton.setAttribute('aria-expanded', String(adding));
    addButton.hidden = !!current && !localAllowed(current);
    if (!current) { status.textContent = pending ? 'Reading the teams on this computer (oats teams)…' : status.textContent; if (cardError) body.append(problemBox(cardError)); return; }
    // The page's own problems (no team card holds them), failures first: team model 3's local-teams-closed leads.
    const pageProblems = list(current.problems).filter(p => !text(p?.label) || !list(current.teams).some(t => t.label === p.label));
    for (const problem of [...pageProblems.filter(p => p.severity === 'failure'), ...pageProblems.filter(p => p.severity !== 'failure')]) {
      const wrap = el(doc, 'div', null, 'ct-problem'); wrap.append(kernelProblem(problem)); body.append(wrap);
    }
    // The default team's card leads its section; the others keep the document's order (a stable sort).
    const teams = list(current.teams).slice().sort((a, b) => (b.default === true) - (a.default === true));
    const shared = teams.filter(t => t.from === 'shared'), local = teams.filter(t => t.from !== 'shared');
    const sharedSection = section('shared', 'Shared with the workspace', 'Shared · Git', false);
    for (const team of shared) sharedSection.append(teamCard(team));
    if (!shared.length) sharedSection.append(emptyCard("No shared teams. A shared team is declared in the workspace's oats-workspace.yaml and committed, so every computer running the workspace has it."));
    const localSection = section('local', 'Only on this computer', 'Not shared', true);
    for (const team of local) localSection.append(teamCard(team));
    if (!local.length && !adding && !localAllowed(current)) localSection.append(emptyCard(`No local teams: ${LOCAL_TEAMS_CLOSED}.`));
    else if (!local.length && !adding) {
      const empty = emptyCard("No local teams. A local team lives in this computer's oats-local.yaml and is visible only here.");
      empty.append(button('Add a local team', 'ct-link', () => openAdd('link')));
      localSection.append(empty);
    }
    if (cardError) localSection.append(problemBox(cardError));
    if (adding && localAllowed(current)) localSection.append(addForm());
    body.append(sharedSection, localSection);
    // Team model 3: the workspace's souls: (none in the standalone view, where no workspace file is read).
    if (model3(current) && current.localTeams !== null) body.append(soulsSection());
    rosterDrawn = rosterKey();
  }
  /** The members changed: redraw only when who is in a team (or their state) changed, and never under an
   * open form, a pending confirmation or the keyboard (a redraw would drop what is typed or focused). */
  function redrawMembers() {
    if (disposed || !current || pending || adding || confirming || page.contains(doc.activeElement) || rosterKey() === rosterDrawn) return;
    render();
  }
  function paintReach() {
    const labels = list(roster?.notReached).map(s => s.label);
    reach.textContent = labels.length ? `Not reached: ${labels.join(', ')}. Their members aren't shown until they answer.` : '';
  }
  /** Read the members (on mount and at each roster poll); the notice follows every answer. */
  async function readRoster() {
    if (typeof readMembers !== 'function') return;
    const ticket = ++rosterSerial;
    let answer; try { answer = membersAnswer(await readMembers()); } catch { answer = null; }
    if (disposed || ticket !== rosterSerial || !answer) return;
    roster = answer; paintReach(); redrawMembers();
  }
  function syncRoster() { void readRoster(); }
  function focusIn(selector) { queueMicrotask(() => page.querySelector(selector)?.focus()); }

  void read(); void readRoster();
  return { element: page, refresh: read, syncRoster, dispose() { disposed = true; serial++; rosterSerial++; } };
}
