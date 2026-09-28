/** Setup's "Teams on this computer" (team model v2, OATS 0.30; spec
 * docs/design/2026-09-27-team-model-v2.md, option B). The shared teams (the committed
 * workspace, read-only here: edited by PR) and the local ones (this computer's
 * oats-local.yaml), each with its id; the default team (changeable); add or remove a
 * local team. The document is the kernel's `oats teams --json` result (K1's shapes,
 * docs/desktop-cli-api.md "Team model v2"), read and changed through `request(body)`:
 * {action: 'list'} | {action: 'add', label, team, description?} | {action: 'remove', label}
 * | {action: 'default', label}, each answering the document after the write. A refusal
 * (E_TEAM_IN_USE, E_TEAM_EXISTS, …) is shown verbatim with its code. The card owns its
 * state, so the Setup view mounts it once and keeps it across re-renders. */
import { box } from './workspace-setup.mjs';

export const computerTeamsCSS = `
.computer-teams .ct-row { display:grid; grid-template-columns:minmax(0,1fr) auto; column-gap:12px; row-gap:4px; align-items:start; padding:10px 16px; border-top:1px solid var(--border); }
.computer-teams .setup-box-head + .ct-row, .computer-teams .setup-box-head + .ct-problem { border-top:0; }
.computer-teams .ct-main { display:flex; flex-direction:column; gap:3px; min-width:0; }
.computer-teams .ct-head { display:flex; align-items:center; flex-wrap:wrap; gap:6px 8px; min-width:0; }
.computer-teams .ct-label { color:var(--fg); font:650 12.5px var(--mono,monospace); overflow-wrap:anywhere; }
.computer-teams .ct-chip { display:inline-flex; align-items:center; height:20px; padding:0 7px; border-radius:5px; background:var(--tag-bg); color:var(--fg); font-size:11px; font-weight:650; white-space:nowrap; }
.computer-teams .ct-from { color:var(--muted); font-size:11.5px; }
.computer-teams .ct-id { color:var(--fg); font:11.5px var(--mono,monospace); overflow-wrap:anywhere; }
.computer-teams .ct-id.none, .computer-teams .ct-warn { color:var(--warn); }
.computer-teams .ct-desc, .computer-teams .ct-why { color:var(--muted); font-size:11.5px; line-height:1.45; overflow-wrap:anywhere; }
.computer-teams .ct-warn { font-size:11.5px; line-height:1.45; overflow-wrap:anywhere; }
.computer-teams .ct-fix { display:block; color:var(--fg); font:11px var(--mono,monospace); overflow-wrap:anywhere; }
.computer-teams .ct-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; }
.oats-view .computer-teams button.ct-act { height:26px; min-height:26px; padding:0 10px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--fg); font:600 11.5px var(--sans,system-ui); white-space:nowrap; cursor:pointer; }
.oats-view .computer-teams button.ct-act:hover:not(:disabled) { background:var(--surface-2); }
.oats-view .computer-teams button.ct-act:disabled { color:var(--muted); cursor:default; }
.oats-view .computer-teams button.ct-act.primary:not(:disabled) { background:var(--primary-bg); border-color:var(--primary-bg); color:var(--primary-fg); }
.oats-view .computer-teams button.ct-act:focus-visible, .computer-teams input:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
.computer-teams .ct-confirm, .computer-teams .ct-error { grid-column:1 / -1; }
.computer-teams .ct-confirm { display:flex; flex-direction:column; gap:8px; padding:8px 10px; border:1px solid var(--border); border-radius:7px; background:var(--surface); }
.computer-teams .ct-confirm p { margin:0; color:var(--fg); font-size:12px; line-height:1.45; }
.computer-teams .ct-error { border-left:2px solid var(--danger); padding-left:8px; color:var(--fg); font-size:12px; line-height:1.45; }
.computer-teams .ct-error p { margin:0; overflow-wrap:anywhere; }
.computer-teams .ct-error summary { color:var(--muted); font-size:11.5px; cursor:pointer; }
.computer-teams .ct-error pre { margin:4px 0 0; color:var(--fg); font:11px var(--mono,monospace); white-space:pre-wrap; overflow-wrap:anywhere; }
.computer-teams .ct-problem { padding:10px 16px; border-top:1px solid var(--border); }
.computer-teams .ct-foot { display:flex; flex-direction:column; gap:8px; padding:10px 16px 12px; border-top:1px solid var(--border); }
.computer-teams .ct-foot > .ct-act { align-self:flex-start; }
.computer-teams .ct-all { margin:0; color:var(--muted); font-size:11.5px; line-height:1.45; overflow-wrap:anywhere; }
.computer-teams .ct-form { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.4fr); gap:8px; }
.computer-teams .ct-form label { display:flex; flex-direction:column; gap:3px; min-width:0; color:var(--muted); font-size:11.5px; }
.computer-teams .ct-form label.wide { grid-column:1 / -1; }
.computer-teams .ct-form input { height:28px; min-width:0; padding:0 8px; box-sizing:border-box; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--fg); font:12px var(--mono,monospace); }
.computer-teams .ct-form .ct-actions { grid-column:1 / -1; justify-content:flex-start; }
.computer-teams .ct-hint { grid-column:1 / -1; margin:0; color:var(--muted); font-size:11.5px; line-height:1.45; }
.computer-teams .ct-hint code { color:var(--fg); font:11px var(--mono,monospace); }
.computer-teams .ct-status { margin:0; padding:10px 16px; color:var(--muted); font-size:12px; }
.computer-teams .ct-status:empty { display:none; }
`;

const text = v => typeof v === 'string' && v ? v : null;
const list = v => Array.isArray(v) ? v : [];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function el(doc, tag, value, cls) {
  const node = doc.createElement(tag);
  if (value !== undefined && value !== null) node.textContent = value;
  if (cls) node.className = cls;
  return node;
}

/** What still references a label in the document (defaultTeam, souls.teams, souls.default):
 * the reason Remove is off, in words. The kernel's own refusal (E_TEAM_IN_USE) stays the authority. */
export function teamInUse(document, label) {
  const reasons = [];
  if (document?.defaultTeam === label) reasons.push('it is the default team');
  const teams = document?.souls?.teams && typeof document.souls.teams === 'object' ? document.souls.teams : {};
  const defaults = document?.souls?.default && typeof document.souls.default === 'object' ? document.souls.default : {};
  if (list(teams['*']).includes(label)) reasons.push('every soul may join it');
  const souls = new Set([...Object.entries(teams).filter(([key, labels]) => key !== '*' && list(labels).includes(label)).map(([key]) => key),
    ...Object.entries(defaults).filter(([, value]) => value === label).map(([key]) => key)]);
  if (souls.size) reasons.push(`${plural(souls.size, 'soul')} use${souls.size === 1 ? 's' : ''} it`);
  return reasons.length ? `Can't remove: ${reasons.join('; ')}. Change that first.` : null;
}

/** Where a team is declared, in words. */
const fromText = from => from === 'shared' ? 'shared · from the workspace' : from === 'local' ? 'local · on this computer' : `from: ${from}`;

export function createComputerTeams(doc, { request }) {
  const card = box(doc, 'Teams on this computer', 'shared and local', 'Not shared', { local: true, icon: 'computer' });
  card.classList.add('computer-teams');
  const status = el(doc, 'p', '', 'ct-status'); status.setAttribute('role', 'status');
  const body = el(doc, 'div', null, 'ct-body');
  card.append(status, body);
  let current = null, pending = false, serial = 0, disposed = false;
  let rowError = null, cardError = null, confirming = null, adding = false;
  const draft = { label: '', team: '', description: '' };

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
    const line = el(doc, 'div', null, 'ct-warn'); line.dataset.problem = problem.code || '';
    line.append(el(doc, 'span', problem.message || problem.code || 'A problem was reported.'));
    if (text(problem.fix)) line.append(el(doc, 'span', problem.fix, 'ct-fix'));
    return line;
  }

  function teamRow(team) {
    const row = el(doc, 'div', null, 'ct-row'); row.dataset.team = team.label;
    const main = el(doc, 'div', null, 'ct-main'), head = el(doc, 'div', null, 'ct-head');
    head.append(el(doc, 'span', team.label, 'ct-label'));
    if (team.default) head.append(el(doc, 'span', 'default', 'ct-chip'));
    head.append(el(doc, 'span', fromText(team.from), 'ct-from'));
    main.append(head);
    main.append(el(doc, 'span', team.team ?? 'no provider id yet', `ct-id${team.team ? '' : ' none'}`));
    if (text(team.description)) main.append(el(doc, 'span', team.description, 'ct-desc'));
    for (const problem of list(current.problems).filter(p => p?.label === team.label)) main.append(kernelProblem(problem));
    const actions = el(doc, 'div', null, 'ct-actions');
    if (!team.default) actions.append(button('Make default', '', () => { confirming = team.label; render(); focusIn(`[data-team="${team.label}"] .ct-confirm .primary`); },
      { disabled: !team.team, title: team.team ? '' : 'A team with no provider id yet cannot be the default.', aria: `Make ${team.label} the default team` }));
    if (team.from === 'local') {
      const why = teamInUse(current, team.label);
      actions.append(button('Remove', '', () => run({ action: 'remove', label: team.label }, { label: team.label }),
        { disabled: !!why, title: why || '', aria: why ? `Remove ${team.label}: ${why}` : `Remove ${team.label}` }));
      if (why) main.append(el(doc, 'span', why, 'ct-why'));
    }
    row.append(main, actions);
    if (confirming === team.label) {
      const confirm = el(doc, 'div', null, 'ct-confirm');
      confirm.append(el(doc, 'p', `Make ${team.label} the default team on this computer? Running instances keep their current default team until they are respawned.`));
      const buttons = el(doc, 'div', null, 'ct-actions');
      buttons.append(button('Make default', 'primary', () => run({ action: 'default', label: team.label }, { label: team.label })),
        button('Cancel', '', () => { confirming = null; render(); focusIn(`[data-team="${team.label}"] .ct-actions button`); }));
      confirm.append(buttons); row.append(confirm);
    }
    if (rowError?.label === team.label) row.append(problemBox(rowError));
    return row;
  }

  function addForm() {
    const form = el(doc, 'form', null, 'ct-form'); form.noValidate = true;
    const field = (name, caption, placeholder, cls = '') => {
      const label = el(doc, 'label', caption, cls), input = el(doc, 'input'); input.name = name; input.value = draft[name]; input.placeholder = placeholder; input.autocomplete = 'off'; input.spellcheck = false;
      input.addEventListener('input', () => { draft[name] = input.value; });
      label.append(input); form.append(label); return input;
    };
    const first = field('label', 'Label', 'antares-oats'); field('team', 'Team id', 'antares-oats:juan.aweb.ai'); field('description', 'Description (optional)', '', 'wide');
    const actions = el(doc, 'div', null, 'ct-actions');
    const submit = button('Add team', 'primary', () => {});
    submit.type = 'submit'; submit.disabled = pending;
    actions.append(submit, button('Cancel', '', () => { adding = false; cardError = null; render(); focusIn('.ct-foot .ct-act'); }));
    const hint = el(doc, 'p', null, 'ct-hint'); hint.append('To create a new team, run ', el(doc, 'code', 'oats aweb setup'), '.');
    form.append(actions, hint);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const label = draft.label.trim(), team = draft.team.trim(), description = draft.description.trim();
      if (!label || !team) { cardError = { message: 'A local team needs a label and its provider team id.' }; render(); return; }
      void run({ action: 'add', label, team, ...(description ? { description } : {}) });
    });
    queueMicrotask(() => { if (first.isConnected && !first.value) first.focus(); });
    return form;
  }

  function render() {
    if (disposed) return;
    body.replaceChildren();
    if (!current) { status.textContent = pending ? 'Reading the teams on this computer (oats teams)…' : status.textContent; if (cardError) body.append(problemBox(cardError)); return; }
    for (const problem of list(current.problems).filter(p => !text(p?.label) || !list(current.teams).some(t => t.label === p.label))) {
      const wrap = el(doc, 'div', null, 'ct-problem'); wrap.append(kernelProblem(problem)); body.append(wrap);
    }
    for (const team of list(current.teams)) body.append(teamRow(team));
    const foot = el(doc, 'div', null, 'ct-foot');
    if (!list(current.teams).length) foot.append(el(doc, 'p', 'No teams on this computer yet. Add a local team, or run oats aweb setup.', 'ct-all'));
    const all = list(current.souls?.teams?.['*']);
    if (all.length) foot.append(el(doc, 'p', `Every soul may join: ${all.join(', ')}.`, 'ct-all'));
    if (cardError) foot.append(problemBox(cardError));
    if (adding) foot.append(addForm());
    else foot.append(button('Add a local team', '', () => { adding = true; cardError = null; render(); }));
    body.append(foot);
  }
  function focusIn(selector) { queueMicrotask(() => card.querySelector(selector)?.focus()); }

  void read();
  return { element: card, refresh: read, dispose() { disposed = true; serial++; } };
}
