/** Team controls on a live instance (teams contract 2026-09-25): the messaging
 * provider's own home operations `messaging:teams|join|leave` through `oats
 * operation run`. Gated on what the provider DECLARES (the operation rows in the
 * home's inspection), never on a provider name or version. The provider's teams
 * document is decoded strictly and bounded; its refusals are shown verbatim. */

/** Layout only (no colour): rows reuse the inspector's AA-tested classes. */
export const teamsCSS = `
.teams-panel .team-row { display:grid; grid-template-columns:minmax(0,1fr) auto; column-gap:12px; row-gap:2px; align-items:center; padding:10px 0; }
.teams-panel .team-row > h4 { grid-column:1; margin:0; font-size:13px; line-height:18px; }
.teams-panel .team-row > p { grid-column:1; margin:0; font-size:12px; line-height:17px; }
.teams-panel .team-row > button { grid-column:2; grid-row:1 / span 3; align-self:center; }
.teams-panel .team-row > details, .teams-panel .team-row > .inspector-problem { grid-column:1 / -1; margin-top:4px; font-size:12px; }
.teams-panel .team-row > details pre { margin:4px 0 0; }
.teams-panel > .act { margin-top:10px; }
.teams-panel .teams-refusal { padding:10px 0; font-size:12px; }
.teams-panel .teams-refusal > p { margin:4px 0 0; }
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

/** The provider's teams document from an operation run result, or null. The run
 * must be `operationsApi: 2` for exactly `address`; the document carries exactly
 * the contract's fields: `{personal{team}, primary, eligible[{label, team, joined}],
 * joined[{label, team, since, identityHome, receive}], unmapped[label], at}`. */
export function teamsDocument(run, address) {
  if (!record(run) || run.operationsApi !== 2 || run.operation !== address) return null;
  const d = run.result;
  if (!exact(d, ['personal', 'primary', 'eligible', 'joined', 'unmapped', 'at'])) return null;
  if (!exact(d.personal, ['team']) || !text(d.personal.team) || !(d.primary === null || label(d.primary)) || !text(d.at, 64)) return null;
  const list = v => Array.isArray(v) && v.length <= 64;
  if (!list(d.eligible) || !list(d.joined) || !list(d.unmapped)) return null;
  if (!d.eligible.every(e => exact(e, ['label', 'team', 'joined']) && label(e.label) && text(e.team) && typeof e.joined === 'boolean')) return null;
  if (!d.joined.every(j => exact(j, ['label', 'team', 'since', 'identityHome', 'receive']) && label(j.label) && text(j.team) && text(j.since, 64)
    && text(j.identityHome, 4096) && j.identityHome.startsWith('/') && text(j.receive, 32))) return null;
  if (!d.unmapped.every(label)) return null;
  const unique = xs => new Set(xs).size === xs.length;
  if (!unique(d.eligible.map(e => e.label)) || !unique(d.joined.map(j => j.label)) || !unique(d.unmapped)) return null;
  return structuredClone({ personal: d.personal, primary: d.primary, eligible: d.eligible, joined: d.joined, unmapped: d.unmapped, at: d.at });
}

/** A provider timestamp, shown deterministically (UTC minutes); anything else as sent. */
export function whenText(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?Z$/.exec(iso);
  return m ? `${m[1]} ${m[2]} UTC` : iso;
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
export function createTeamsPanel(parent, { operations, selector, request, owns, available = () => true }) {
  const doc = parent.ownerDocument;
  const node = (tag, value, cls) => { const el = doc.createElement(tag); if (value !== undefined) el.textContent = value; if (cls) el.className = cls; return el; };
  const section = node('section', undefined, 'teams-panel');
  section.append(node('h3', 'Teams'));
  parent.append(section);
  if (!operations.supported) { section.append(node('p', 'Not supported by this messaging provider.', 'muted')); return { sync() {}, refresh() {} }; }
  if (!operations.teams.available) { section.append(node('p', operations.teams.reason || 'The provider cannot list teams here.', 'muted')); return { sync() {}, refresh() {} }; }
  const status = node('p', '', 'inspector-status'); status.setAttribute('role', 'status');
  const body = node('div', undefined, 'teams-body');
  const refresh = node('button', 'Refresh teams', 'act'); refresh.type = 'button';
  section.append(status, body, refresh);
  let serial = 0, pending = null, current = null, rowError = null;
  const live = () => owns() && section.isConnected;
  const say = (value, error = false) => { status.textContent = value; status.classList.toggle('error', error); };
  function problem(error, fallback) {
    const code = typeof error?.code === 'string' ? error.code : '';
    const box = node('div', undefined, 'inspector-problem');
    box.append(node('p', typeof error?.message === 'string' && error.message ? error.message : fallback));
    if (code) { const more = node('details'); more.append(node('summary', 'Details'), node('p', code, 'muted')); box.append(more); }
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
      say(''); body.replaceChildren(problem(error, 'The messaging provider could not list teams.'));
      const retry = node('button', 'Retry', 'act'); retry.type = 'button'; retry.addEventListener('click', () => { if (live() && !pending) void read({ explicit: true }); }); body.append(retry);
    } finally { if (ticket === serial) { pending = null; if (live()) sync(); } }
  }
  async function change(verb, target) {
    const op = operations[verb];
    if (!op || !op.arg || pending || !live() || !available()) return;
    const ticket = ++serial; pending = { verb, label: target }; rowError = null; render(); sync();
    try {
      const result = await request({ action: 'run', selector, operation: op.address, args: { [op.arg]: target } });
      if (!live() || ticket !== serial) return;
      const next = teamsDocument(result, op.address);
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
    const op = operations[verb], b = node('button', verb === 'join' ? 'Join' : 'Leave', 'act'); b.type = 'button';
    b.dataset.team = target; b.dataset.teamAction = verb;
    if (pending?.label === target && pending.verb === verb) b.textContent = verb === 'join' ? 'Joining…' : 'Leaving…';
    if (!op) b.title = `This messaging provider does not declare messaging:${verb}.`;
    else if (!op.arg) b.title = `This provider's messaging:${verb} needs arguments the Desktop cannot supply; use the OATS CLI.`;
    else if (!op.available) b.title = op.reason || '';
    b.addEventListener('click', () => { if (!b.disabled) void change(verb, target); });
    return b;
  }
  function render() {
    body.replaceChildren();
    if (!current) return;
    const personal = node('div', undefined, 'inspector-cap team-row'); personal.dataset.teamRow = 'personal';
    personal.append(node('h4', 'Personal team'), node('p', current.personal.team, 'muted'), node('p', "Always on — the personal team can't be left.", 'muted'));
    body.append(personal);
    const joined = new Map(current.joined.map(j => [j.label, j]));
    const rows = [...current.eligible.map(e => ({ label: e.label, team: e.team, eligible: true })),
      ...current.joined.filter(j => !current.eligible.some(e => e.label === j.label)).map(j => ({ label: j.label, team: j.team, eligible: false }))];
    // A refusal whose row the re-read no longer offers is said at panel level, never dropped.
    if (rowError && !rows.some(row => row.label === rowError.label)) {
      const gone = node('div', undefined, 'teams-refusal'); gone.dataset.teamRefusal = rowError.label;
      gone.append(problem(rowError.error, 'The messaging provider refused.'), node('p', `${rowError.label} is no longer offered to this instance.`, 'muted'));
      body.prepend(gone);
    }
    for (const row of rows) {
      const j = joined.get(row.label), el = node('div', undefined, 'inspector-cap team-row'); el.dataset.teamRow = row.label;
      el.append(node('h4', row.label === current.primary ? `${row.label} · primary` : row.label), node('p', row.team, 'muted'));
      if (j) {
        const since = node('p', `Joined ${whenText(j.since)}`); since.title = j.since;
        el.append(since, node('p', receiveText(j.receive).replace(/^./, c => c.toUpperCase()), 'muted'));
        const where = node('details'); where.append(node('summary', 'Identity home'), node('pre', j.identityHome)); el.append(where);
        if (!row.eligible) el.append(node('p', 'No longer eligible in this workspace.', 'muted'));
        el.append(control('leave', row.label));
      } else el.append(node('p', 'Not joined.', 'muted'), control('join', row.label));
      if (rowError?.label === row.label) el.append(problem(rowError.error, 'The messaging provider refused.'));
      body.append(el);
    }
    for (const unmapped of current.unmapped) {
      const el = node('div', undefined, 'inspector-cap team-row'); el.dataset.teamRow = unmapped;
      el.append(node('h4', unmapped), node('p', "Not mapped by this workspace — can't be joined.", 'muted'));
      body.append(el);
    }
    if (!rows.length) body.append(node('p', current.unmapped.length ? "None of this soul's teams is mapped by this workspace." : 'Personal team only: the soul names no wider team.', 'muted'));
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
