/** Team controls on a live instance (teams contract 2026-09-25): the messaging
 * provider's own home operations `messaging:teams|join|leave` through `oats
 * operation run`. Gated on what the provider DECLARES (the operation rows in the
 * home's inspection), never on a provider name or version. The provider's teams
 * document is decoded strictly and bounded; its refusals are shown verbatim. */

/** One card, the same in the Workspace inspector and the context panel:
 * tokens only (computed-AA inventory in theme-contrast), no opacity. */
export const teamsCSS = `
.teams-panel { display:flex; flex-direction:column; gap:8px; min-width:0; }
.teams-panel .teams-status { margin:0; font-size:12px; line-height:1.45; color:var(--muted); }
.teams-panel .teams-status:empty { display:none; }
.teams-panel .teams-status.error { color:var(--danger); }
.teams-panel .teams-card { border:1px solid var(--border); border-radius:8px; background:var(--surface); overflow:hidden; }
.teams-panel .teams-card:empty { display:none; }
.teams-panel .team-row { display:grid; grid-template-columns:minmax(0,1fr) auto; column-gap:12px; row-gap:6px; align-items:center; padding:9px 12px; min-height:44px; box-sizing:border-box; }
.teams-panel .team-row + .team-row, .teams-panel .teams-card > .teams-note { border-top:1px solid var(--border); }
.teams-panel .team-main { display:flex; flex-direction:column; gap:2px; min-width:0; }
.teams-panel .team-name { font-size:12.5px; font-weight:650; line-height:1.4; color:var(--fg); overflow-wrap:anywhere; }
.teams-panel .team-meta { font-size:11.5px; line-height:1.4; color:var(--muted); overflow-wrap:anywhere; }
.teams-panel .team-badge { font-size:11px; font-weight:650; line-height:1; color:var(--muted); border:1px solid var(--border); border-radius:999px; padding:4px 8px; white-space:nowrap; }
.teams-panel .team-action { font:600 11.5px/1 inherit; height:26px; padding:0 10px; border-radius:6px; border:1px solid var(--border); background:var(--surface); color:var(--fg); cursor:pointer; white-space:nowrap; }
.teams-panel .team-action:hover:not(:disabled) { background:var(--surface-2); }
.teams-panel .team-action:disabled { color:var(--muted); cursor:default; }
.teams-panel .team-action:focus-visible, .teams-panel .teams-refresh:focus-visible, .teams-panel summary:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.teams-panel .team-row > details, .teams-panel .team-row > .teams-problem { grid-column:1 / -1; }
.teams-panel details { font-size:11.5px; color:var(--muted); }
.teams-panel details > summary { cursor:pointer; }
.teams-panel details pre { margin:4px 0 0; font:11px/1.55 ui-monospace, Menlo, monospace; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--fg); }
.teams-panel .teams-problem { border-left:2px solid var(--danger); padding-left:8px; font-size:12px; color:var(--fg); }
.teams-panel .teams-problem > p { margin:0; }
.teams-panel .teams-refusal { padding:9px 12px; }
.teams-panel .teams-note { margin:0; padding:9px 12px; font-size:12px; color:var(--muted); }
.teams-panel .teams-refresh { align-self:flex-start; font:600 11.5px/1 inherit; height:26px; padding:0 10px; border-radius:6px; border:1px solid var(--border); background:var(--surface); color:var(--fg); cursor:pointer; }
.teams-panel .teams-refresh:disabled { color:var(--muted); cursor:default; }
`;

const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const text = (v, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const label = v => typeof v === 'string' && LABEL.test(v);
const ARG = /^[a-z][a-z0-9-]{0,63}$/;

/** The provider's declared team operations, or null when no messaging provider
 * fills the layer. `supported: false` means the provider declares no
 * `messaging:teams` (the panel then says so; it is never an error). */
export function teamsOperations(inspected) {
  const provider = (inspected?.capabilities || []).find(cap => cap?.layer === 'messaging');
  if (!provider) return null;
  const row = name => (Array.isArray(provider.operations) ? provider.operations : []).find(op => op?.name === name) ?? null;
  const teams = row('teams');
  if (!teams) return { provider: provider.id, supported: false };
  // join/leave take the label list as their one required argument; its name is the provider's.
  const action = name => {
    const op = row(name);
    if (!op) return null;
    const required = (Array.isArray(op.args) ? op.args : []).filter(a => a?.required === true);
    return { address: `messaging:${name}`, available: op.available !== false, reason: op.reason ?? null,
      arg: required.length === 1 && ARG.test(required[0].name ?? '') ? required[0].name : null };
  };
  return { provider: provider.id, supported: true, teams: { address: 'messaging:teams', available: teams.available !== false, reason: teams.reason ?? null },
    join: action('join'), leave: action('leave') };
}

/** Where the provider found the workspace's default team (1.16 `defaultTeam.source`):
 * `setting` = settings.oats.aweb.team named it; `root` = the messaging root's active team. */
const DEFAULT_SOURCE = Object.freeze({ __proto__: null, setting: 'set by the workspace or host setting', root: "the messaging root's active team" });

/** The provider's teams document from an operation run result, or null. The run
 * must be `operationsApi: 2` for exactly `address`; the document carries exactly
 * the contract's fields (1.16 names, its AMENDMENT c129125a): `{defaultTeam{team, source: setting|root},
 * primary, eligible[{label, team, joined}],
 * joined[{label, team, since, identityHome, receive}], unmapped[label], at}`.
 * A join/leave answer (`{ actions: true }`) may also carry what it did, as the
 * real provider sends it (oats.aweb 1.15+; teams contract 089cff5c): `actions[{action:
 * join|leave, label, released?, receipt?}]`, each label an eligible or joined row;
 * the receipt is opaque provider evidence, never shown. The panel repaints from the document. */
export function teamsDocument(run, address, { actions = false } = {}) {
  if (!record(run) || run.operationsApi !== 2 || run.operation !== address) return null;
  const d = run.result, did = actions && record(d) && Object.hasOwn(d, 'actions');
  if (!exact(d, ['defaultTeam', 'primary', 'eligible', 'joined', 'unmapped', 'at', ...(did ? ['actions'] : [])])) return null;
  if (did && !(Array.isArray(d.actions) && d.actions.length <= 64 && d.actions.every(actionRow))) return null;
  // The workspace's default team: its id, and where the provider found it (always sent, a closed set).
  const home = d.defaultTeam;
  if (!exact(home, ['team', 'source']) || !text(home.team) || !Object.hasOwn(DEFAULT_SOURCE, home.source)) return null;
  if (!(d.primary === null || label(d.primary)) || !text(d.at, 64)) return null;
  const list = v => Array.isArray(v) && v.length <= 64;
  if (!list(d.eligible) || !list(d.joined) || !list(d.unmapped)) return null;
  if (!d.eligible.every(e => exact(e, ['label', 'team', 'joined']) && label(e.label) && text(e.team) && typeof e.joined === 'boolean')) return null;
  if (!d.joined.every(j => exact(j, ['label', 'team', 'since', 'identityHome', 'receive']) && label(j.label) && text(j.team) && text(j.since, 64)
    && text(j.identityHome, 4096) && j.identityHome.startsWith('/') && text(j.receive, 32))) return null;
  if (!d.unmapped.every(label)) return null;
  const unique = xs => new Set(xs).size === xs.length;
  if (!unique(d.eligible.map(e => e.label)) || !unique(d.joined.map(j => j.label)) || !unique(d.unmapped)) return null;
  // Each action names a row this answer reports (eligible or joined), as the contract says.
  if (did && !d.actions.every(x => d.eligible.some(e => e.label === x.label) || d.joined.some(j => j.label === x.label))) return null;
  return structuredClone({ defaultTeam: d.defaultTeam, primary: d.primary, eligible: d.eligible, joined: d.joined, unmapped: d.unmapped, at: d.at,
    ...(did ? { actions: d.actions } : {}) });
}
/** One `actions` row of a join/leave answer: the verb and label, an optional
 * `released` word, an optional provider receipt (a bounded record, kept opaque). */
function actionRow(a) {
  if (!record(a) || !['join', 'leave'].includes(a.action) || !label(a.label)) return false;
  if (!Object.keys(a).every(k => ['action', 'label', 'released', 'receipt'].includes(k))) return false;
  if (Object.hasOwn(a, 'released') && !text(a.released, 32)) return false;
  if (Object.hasOwn(a, 'receipt') && !(record(a.receipt) && JSON.stringify(a.receipt).length <= 4096)) return false;
  return true;
}

/** A provider timestamp, shown deterministically (UTC minutes); anything else as sent. */
export function whenText(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?Z$/.exec(iso);
  return m ? `${m[1]} ${m[2]} UTC` : iso;
}
/** Team labels a refusal names (E_TEAM_CONFLICT details.labels): 2..16 distinct labels, or null. */
export function teamLabels(v) {
  return Array.isArray(v) && v.length >= 2 && v.length <= 16 && v.every(label) && new Set(v).size === v.length ? [...v] : null;
}
/** The soul's eligible teams as `oats inspect` reports them (kernel `teams`,
 * primary first): `[{label, team, mapped}]`, or null when not reported or not
 * readable. `mapped` and `team` must agree (a mapped label names its team). */
export function soulTeams(v) {
  if (!Array.isArray(v) || v.length > 64) return null;
  const out = [];
  for (const t of v) {
    if (!record(t) || !label(t.label) || typeof t.mapped !== 'boolean' || (t.mapped ? !text(t.team) : t.team !== null)) return null;
    out.push({ label: t.label, team: t.team, mapped: t.mapped });
  }
  return new Set(out.map(t => t.label)).size === out.length ? out : null;
}
/** How a joined team's mail reaches the instance — never implying live delivery for a poll team. */
export function receiveText(receive) {
  if (receive === 'poll') return "checks this team's mail between tasks";
  if (receive === 'native') return "receives this team's mail as it arrives";
  return `receive: ${receive}`;
}

/** One Teams section for an instance home. `request(body)` posts to the
 * capabilities route; `owns()` is the inspector's selection lifetime (checked
 * on success AND rejection); `available()` the CLI gate. */
export function createTeamsPanel(parent, { operations, selector, request, owns, available = () => true, heading = true }) {
  const doc = parent.ownerDocument;
  const node = (tag, value, cls) => { const el = doc.createElement(tag); if (value !== undefined) el.textContent = value; if (cls) el.className = cls; return el; };
  const section = node('section', undefined, 'teams-panel');
  if (heading) section.append(node('h3', 'Teams'));
  parent.append(section);
  if (!operations.supported) { section.append(node('p', 'Not supported by this messaging provider.', 'teams-status')); return { sync() {}, refresh() {} }; }
  if (!operations.teams.available) { section.append(node('p', operations.teams.reason || 'The provider cannot list teams here.', 'teams-status')); return { sync() {}, refresh() {} }; }
  const status = node('p', '', 'teams-status'); status.setAttribute('role', 'status');
  // What the list is: the workspace's default team, then the teams the soul has access to (unmapped labels are not shown).
  const intro = node('p', "Always in the workspace's default team. It can join the teams its soul has access to.", 'teams-note teams-intro'); intro.hidden = true;
  const body = node('div', undefined, 'teams-card');
  const refresh = node('button', 'Refresh teams', 'teams-refresh'); refresh.type = 'button';
  section.append(intro, status, body, refresh);
  // One row: name + meta lines on the left, the action or a badge on the right.
  const teamRow = (key, name, metas, side) => {
    const el = node('div', undefined, 'team-row'); el.dataset.teamRow = key;
    const main = node('div', undefined, 'team-main'); main.append(node('div', name, 'team-name'));
    for (const meta of metas) main.append(typeof meta === 'string' ? node('div', meta, 'team-meta') : meta);
    el.append(main); if (side) el.append(side); return el;
  };
  const badge = (text, title) => { const b = node('span', text, 'team-badge'); if (title) b.title = title; return b; };
  let serial = 0, pending = null, current = null, rowError = null;
  const live = () => owns() && section.isConnected;
  const say = (value, error = false) => { status.textContent = value; status.classList.toggle('error', error); };
  function problem(error, fallback) {
    const code = typeof error?.code === 'string' ? error.code : '';
    const box = node('div', undefined, 'teams-problem');
    box.append(node('p', typeof error?.message === 'string' && error.message ? error.message : fallback));
    if (code) { const more = node('details'); more.append(node('summary', 'Details'), node('pre', code)); box.append(more); }
    return box;
  }
  function unreadable(result) {
    return result?.operationsApi === 1 ? 'This workspace still uses the classic layout, which answers an older operation result.'
      : 'The messaging provider answered teams this Desktop cannot read.';
  }
  // `explicit`: Refresh/Retry clear a refusal; the re-read after a refusal keeps it.
  async function read({ explicit = false } = {}) {
    const ticket = ++serial; pending = 'read'; if (explicit) rowError = null; say('Reading teams…'); sync();
    try {
      const result = await request({ action: 'run', selector, operation: operations.teams.address });
      if (!live() || ticket !== serial) return;
      const next = teamsDocument(result, operations.teams.address);
      if (!next) { current = null; body.replaceChildren(); say(unreadable(result), true); return; }
      current = next; say(''); render();
    } catch (error) {
      if (!live() || ticket !== serial) return;
      say('');
      const retry = node('button', 'Retry', 'team-action'); retry.type = 'button'; retry.addEventListener('click', () => { if (live() && !pending) void read({ explicit: true }); });
      const failed = node('div', undefined, 'team-row'); failed.append(problem(error, 'The messaging provider could not list teams.'), retry);
      body.replaceChildren(failed);
    } finally { if (ticket === serial) { pending = null; if (live()) sync(); } }
  }
  async function change(verb, target) {
    const op = operations[verb];
    if (!op || !op.arg || pending || !live() || !available()) return;
    const ticket = ++serial; pending = { verb, label: target }; rowError = null; render(); sync();
    try {
      const result = await request({ action: 'run', selector, operation: op.address, args: { [op.arg]: target } });
      if (!live() || ticket !== serial) return;
      const next = teamsDocument(result, op.address, { actions: true });
      pending = null;
      if (!next) { say(unreadable(result), true); render(); return; }
      current = next; say(''); render();
    } catch (error) {
      if (!live() || ticket !== serial) return;
      // The refusal stays under its row, verbatim; the panel keeps its last good
      // state, then re-reads what the provider now reports.
      pending = null; rowError = { label: target, error }; render();
      void read();
    } finally { if (ticket === serial && pending && typeof pending === 'object') { pending = null; if (live()) { render(); sync(); } } }
  }
  function control(verb, target) {
    const op = operations[verb], b = node('button', verb === 'join' ? 'Join' : 'Leave', 'team-action'); b.type = 'button';
    b.dataset.team = target; b.dataset.teamAction = verb;
    if (pending?.label === target && pending.verb === verb) b.textContent = verb === 'join' ? 'Joining…' : 'Leaving…';
    if (!op) b.title = `This messaging provider does not declare messaging:${verb}.`;
    else if (!op.arg) b.title = `This provider's messaging:${verb} needs arguments the Desktop cannot supply; use the OATS CLI.`;
    else if (!op.available) b.title = op.reason || '';
    b.addEventListener('click', () => { if (!b.disabled) void change(verb, target); });
    return b;
  }
  function render() {
    body.replaceChildren(); intro.hidden = !current;
    if (!current) return;
    body.append(teamRow('default', 'Default team', [`${current.defaultTeam.team} · ${DEFAULT_SOURCE[current.defaultTeam.source]}`], badge('Always on', "The workspace's default team can't be left.")));
    const joined = new Map(current.joined.map(j => [j.label, j]));
    const rows = [...current.eligible.map(e => ({ label: e.label, team: e.team, eligible: true })),
      ...current.joined.filter(j => !current.eligible.some(e => e.label === j.label)).map(j => ({ label: j.label, team: j.team, eligible: false }))];
    // A refusal whose row the re-read no longer offers is said at panel level, never dropped.
    if (rowError && !rows.some(row => row.label === rowError.label)) {
      const gone = node('div', undefined, 'teams-refusal'); gone.dataset.teamRefusal = rowError.label;
      gone.append(problem(rowError.error, 'The messaging provider refused.'), node('p', `${rowError.label} is no longer offered to this instance.`, 'teams-note'));
      body.prepend(gone);
    }
    for (const row of rows) {
      const j = joined.get(row.label), name = row.label === current.primary ? `${row.label} · primary` : row.label;
      let el;
      if (j) {
        const since = node('div', `${row.team} · Joined ${whenText(j.since)}`, 'team-meta'); since.title = j.since;
        const metas = [since, receiveText(j.receive).replace(/^./, c => c.toUpperCase())];
        if (!row.eligible) metas.push('No longer eligible in this workspace.');
        el = teamRow(row.label, name, metas, control('leave', row.label));
        const where = node('details'); where.append(node('summary', 'Identity home'), node('pre', j.identityHome)); el.append(where);
      } else el = teamRow(row.label, name, [`${row.team} · Not joined`], control('join', row.label));
      if (rowError?.label === row.label) el.append(problem(rowError.error, 'The messaging provider refused.'));
      body.append(el);
    }
    if (!rows.length) body.append(node('p', 'Its soul has access to no other team.', 'teams-note'));
    sync();
  }
  function sync() {
    refresh.disabled = !!pending || !available() || !live();
    for (const b of body.querySelectorAll('[data-team-action]')) {
      const op = operations[b.dataset.teamAction];
      b.disabled = !!pending || !available() || !live() || !op || !op.arg || !op.available;
    }
  }
  refresh.addEventListener('click', () => { if (live() && !pending) void read({ explicit: true }); });
  void read();
  return { sync, refresh: () => { if (live() && !pending) void read({ explicit: true }); } };
}
