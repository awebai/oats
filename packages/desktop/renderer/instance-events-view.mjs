/** Explicit selected-instance activity. One retained observation per popup,
 * no cross-selection/server cache, no background reads, no lifecycle authority. */
import { postJson, workspaceGeneration } from './views/common.mjs';
import { cliStatus, onCliChange } from './views/cli-status.mjs';
import { absolute } from './readiness-contract.mjs';
import { eventsSelector, eventsSupported, eventsTarget, eventsFailure, eventsTimestamp } from './instance-events-contract.mjs';
import { codeLineNodes, readingFrom, remoteReason } from './remote-address.mjs';
import { eventsData, eventsIncomplete, eventIncarnation, EVENT_TITLES } from './instance-events-data.mjs';
export const instanceEventsCSS = `
.events-view { color:var(--fg); margin-top:10px; padding-top:10px; border-top:1px solid var(--border); font-size:11px; line-height:1.5; }
.events-view h3 { font-size:12px; margin:0 0 6px; }
.events-view p { margin:6px 0; }
.events-status, .events-note, .events-source, .events-incarnation { color:var(--muted); }
.events-integrity { color:var(--warn); }
.events-view button { min-height:30px; }
.events-view summary { cursor:pointer; color:var(--fg); }
.events-view [hidden], .events-status:empty { display:none; }
.events-rows { max-height:220px; overflow:auto; padding-left:18px; margin:8px 0; }
.events-rows li { margin:0 0 10px; overflow-wrap:anywhere; }
.events-rows time { display:block; color:var(--muted); font-variant-numeric:tabular-nums; }
.events-facts { margin:4px 0; }
.events-facts dt { color:var(--muted); }
.events-facts dd { margin:0 0 3px; }
.events-claims { padding-left:18px; margin:8px 0; }
`;
const UNKNOWN = 'Activity: unknown · Waiting on you: unknown';
const title = kind => Object.hasOwn(EVENT_TITLES, kind) ? EVENT_TITLES[kind] : `Other reported event (${kind})`;
const incarnationLabel = (row, value) => ({ current: 'Current recorded incarnation', earlier: 'Earlier instance at this address', unknown: 'Incarnation not reported' })[eventIncarnation(row, value)];
const setText = (element, value) => { if (element.textContent === value) return false; element.textContent = value; return true; };
const labels = { agent: 'Soul', work: 'Work mode', branch: 'Branch', harness: 'Harness', model: 'Model', parentInstance: 'Parent', relation: 'Relation',
  launched: 'Launch reported', backend: 'Backend', launchConfig: 'Launch configuration', phase: 'Phase', signal: 'Signal', state: 'State reported',
  waitedMs: 'Waited (ms)', stillRunningCount: 'Targets still running', planRevision: 'Plan revision', children: 'Children', dirty: 'Changed work count',
  keepDir: 'Home retained', self: 'Self retirement', quarantine: 'Quarantine', workRecovery: 'Recovery path', movedTo: 'Retained path',
  recordedBranch: 'Recorded branch', child: 'Child', previous: 'Previous composition path', soulDir: 'Soul path', blocks: 'Blocks',
  waitingOnYou: 'Waiting claim', reason: 'Reported reason', message: 'Note',
  status: 'Reported outcome', class: 'Prompt class', action: 'Launch action', consentSource: 'Consent source' };

export function createInstanceEventsView(host, { ctx, selection, owner = () => true, summary, layout = () => {},
  cli = cliStatus, subscribeCli = onCliChange, generation = workspaceGeneration,
  connectionGeneration = () => ctx?.connectionGeneration?.() ?? 0, subscribeConnections = ctx?.subscribeConnections } = {}) {
  const doc = host.ownerDocument, win = doc.defaultView;
  const node = (tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const section = node('section', undefined, 'events-view'); section.setAttribute('aria-label', 'Reported lifecycle activity');
  const heading = node('h3', 'Reported lifecycle activity');
  const load = node('button', 'Load activity', 'act events-load'); load.type = 'button';
  const status = node('p', '', 'events-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const disclosure = node('details', undefined, 'events-details'); disclosure.hidden = true;
  disclosure.append(node('summary', 'Recent lifecycle events'));
  const content = node('div'); disclosure.append(content);
  section.append(heading, load, status, disclosure); host.append(section);
  let alive = true, serial = 0, cliEpoch = 0, key = null, value = null, busy = false, stale = false, attempted = false;
  // `messageNodes`: a remote refusal's status as nodes (its host's message alone in its <bdi>); `message` is its text.
  let message = '', messageNodes = null, statusText = '', wasVisible = true, wasValid = false;
  const say = (text, nodes = null) => { message = text; messageNodes = nodes; };
  function visible() {
    if (!section.isConnected || doc.visibilityState === 'hidden') return false;
    for (let el = section; el; el = el.parentElement) if (el.hidden || el.inert || el.hasAttribute('inert') || el.style.display === 'none' || el.style.visibility === 'hidden') return false;
    return true;
  }
  function selected() {
    const s = selection?.(), selector = eventsSelector(s?.selector);
    // A remote row is read on its own machine; the server admits it (addressable, routed), not this view.
    if (!s || !selector || !s.workspace || !absolute(s.home) || s.home.split('/').at(-1) !== selector.instance
      || !(s.incarnation == null || eventsTimestamp(s.incarnation))) return null;
    return { workspace: s.workspace, selector, home: s.home, incarnation: s.incarnation ?? null,
      ...(selector.server ? { serverLabel: typeof s.serverLabel === 'string' && s.serverLabel ? s.serverLabel : selector.server } : {}) };
  }
  const selectedKey = s => s ? JSON.stringify([generation(), connectionGeneration(), s]) : null;
  const cliKey = () => { const c = cli(); return JSON.stringify([cliEpoch, c?.ok, c?.bin, c?.version, c?.eventsApi, c?.features, c?.probedAt]); };
  function validTarget() { try { return alive && owner() && visible() && !!selected(); } catch { return false; } }
  function paintSummary() {
    if (!summary) return;
    if (!value) return setText(summary, UNKNOWN);
    const last = value.lastEvent, waiting = value.waitingOnYou;
    return setText(summary, `${stale ? 'Last observation — ' : ''}${last ? `${title(last.kind)} · ${last.at} · ${incarnationLabel(last, value)}` : 'No recorded lifecycle events in this observed window.'} · ${waiting ? `Reported waiting: ${waiting.producer} since ${waiting.since}${waiting.message ? ` — ${waiting.message}` : ''}` : 'Waiting on you: unknown'}`);
  }
  function controls() {
    const supported = eventsSupported(cli()), valid = validTarget();
    load.disabled = !valid || !supported;
    // Refresh can supersede an in-flight read; the server coalesces duplicates.
    setText(load, attempted || value ? 'Refresh activity' : 'Load activity');
    section.setAttribute('aria-busy', String(busy));
    const reason = !selected() ? 'Choose a current, qualified local instance.' : !supported ? eventsFailure('E_EVENTS_UNAVAILABLE').reason.message : '';
    load.title = reason || 'Read this selected address only. No lifecycle action.';
    const text = [message, reason].filter(Boolean).join(' ');
    // Compared with what was last painted, kept here: the rendered line is never read back.
    const statusChanged = text !== statusText;
    if (statusChanged) { statusText = text; status.replaceChildren(...(messageNodes ? [...messageNodes(), ...(reason ? [` ${reason}`] : [])] : text ? [text] : [])); }
    const summaryChanged = paintSummary();
    if ((statusChanged || summaryChanged) && alive && owner() && visible()) layout();
  }
  function invalidate(reason = '', clear = false) {
    serial++; busy = false; stale = !!value;
    if (clear) { value = null; stale = false; attempted = false; content.replaceChildren(); disclosure.hidden = true; }
    say(reason); controls();
  }
  function sync() {
    if (!alive) return;
    const next = selectedKey(selected()), showing = visible(), valid = validTarget();
    if (next !== key) { key = next; invalidate('', true); }
    else if (wasVisible && !showing || wasValid && !valid) invalidate(value ? 'Last observation retained; refresh activity when this selection is current and visible.' : 'Activity read cancelled while this selection is unavailable.');
    wasVisible = showing; wasValid = valid; controls();
  }
  function render() {
    const frag = doc.createDocumentFragment();
    frag.append(node('p', `${value.returned} displayed / ${value.count} observed rows${value.truncated ? ' · truncated' : ''}. This is address history, not current runtime state.`, 'events-note'));
    if (eventsIncomplete(value)) {
      const i = value.integrity;
      frag.append(node('p', `Incomplete evidence: ${i.unreadableRows} unreadable rows · ${i.foreignRows} foreign rows${value.truncated ? ' · window or source truncated' : ''}${i.sources.some(s => s.status === 'refused') ? ' · source refused' : ''}.`, 'events-integrity'));
    }
    frag.append(node('p', value.integrity.sources.map(s => `${s.path}: ${s.status} (${s.bytes} bytes reported)`).join(' · '), 'events-source'));
    if (value.waitingClaims.length) {
      const claims = node('ul', undefined, 'events-claims');
      for (const c of value.waitingClaims) claims.append(node('li', `${c.producer}: ${c.waiting ? 'reported waiting' : 'claim cleared'} · ${c.since}${c.reason ? ` · ${c.reason}` : ''}`));
      frag.append(claims);
    }
    if (!value.events.length) frag.append(node('p', 'No recorded lifecycle events in this observed window.', 'events-note'));
    const rows = node('ol', undefined, 'events-rows');
    for (const row of [...value.events].reverse()) {
      const item = node('li'); item.append(node('strong', title(row.kind)));
      const at = node('time', row.at); at.dateTime = row.at; item.append(at);
      item.append(node('span', `Producer: ${row.producer} · ${incarnationLabel(row, value)}`, 'events-incarnation'));
      const facts = node('dl', undefined, 'events-facts');
      for (const [name, fact] of Object.entries(row.data)) {
        if (name === 'policy') { facts.append(node('dt', 'Reported child policy'), node('dd', `${fact.allowed ? 'allowed' : 'not allowed'} · ${fact.origin.kind}`)); continue; }
        if (!Object.hasOwn(labels, name)) continue;
        // A waiting claim set (true) or cleared (false), in words.
        const text = fact === null ? 'not reported' : name === 'waitingOnYou' ? (fact ? 'claimed' : 'cleared') : String(fact);
        facts.append(node('dt', labels[name]), node('dd', text));
      }
      item.append(facts); rows.append(item);
    }
    frag.append(rows, node('p', 'Null waiting means unknown, not “not waiting”. Paths and past plans are provenance only; no action is authorized by these events.', 'events-note'));
    content.replaceChildren(frag); disclosure.hidden = false;
  }
  async function read() {
    sync();
    if (!validTarget() || !eventsSupported(cli())) return;
    const selectedAtStart = selected(), selectedIdentity = key, cliIdentity = cliKey(), ticket = ++serial;
    attempted = true; busy = true; stale = !!value;
    say(selectedAtStart.serverLabel ? readingFrom(selectedAtStart.serverLabel) : 'Reading reported lifecycle activity…'); controls();
    const owns = () => alive && serial === ticket && validTarget() && selectedKey(selected()) === selectedIdentity && cliKey() === cliIdentity;
    try {
      const response = await postJson(ctx, `/api/instance-events?ws=${encodeURIComponent(selectedAtStart.workspace)}`, { action: 'read', selector: selectedAtStart.selector, limit: 100 });
      if (!owns()) return;
      if (response?.instanceEventsViewApi !== 1) throw { code: 'E_CLI_PROTOCOL' };
      if (response.status !== 'available') throw { code: response.reason?.code, reason: remoteReason(response.reason) };
      const target = eventsTarget(response.target);
      if (!target || target.workspace !== selectedAtStart.workspace || target.home !== selectedAtStart.home || target.incarnation !== selectedAtStart.incarnation
        || Object.keys(selectedAtStart.selector).some(k => target.selector[k] !== selectedAtStart.selector[k])) throw { code: 'E_CLI_PROTOCOL' };
      const next = eventsData(response.data, target, 100, { publicView: true });
      if (!next || new TextEncoder().encode(JSON.stringify(next)).length > 4194304) throw { code: 'E_CLI_PROTOCOL' };
      value = next; stale = false; say('Reported observation loaded. Runtime state is shown separately.');
      render();
    } catch (error) {
      if (!owns()) return;
      // A remote read's reason: the host's headline, then its code and message.
      const reason = error?.reason || eventsFailure(error?.code).reason;
      stale = !!value;
      const tail = value ? ' Last observation retained — refresh required.' : '';
      if (reason.remote && reason.code !== 'unsupported-remote-operation') {
        // A revalidated reason's detail is null or already a display line: the text below is what the nodes say.
        say(`${reason.message} (${reason.code}${reason.detail === null ? '' : `: ${reason.detail}`})${tail}`,
          () => [`${reason.message} (`, ...codeLineNodes(doc, reason), `)${tail}`]);
      } else say(`${reason.message}${tail}`);
    } finally { if (owns()) { busy = false; controls(); } }
  }
  load.addEventListener('click', () => { if (!load.disabled) void read(); });
  disclosure.addEventListener('toggle', () => { if (alive && owner() && visible()) layout(); });
  const offCli = subscribeCli?.(() => { if (alive) { cliEpoch++; invalidate(value ? 'CLI observation changed. Last activity observation retained; refresh required.' : ''); } });
  const offConnection = subscribeConnections?.(() => { if (alive) {
    key = selectedKey(selected()); invalidate('Connection changed. Load activity again.', true);
  } });
  // Observe owner visibility, not descendant rows or transient popup reparenting
  // during roster paint. Old attribute values catch hide→show ABA in one turn.
  const observer = typeof win.MutationObserver === 'function' ? new win.MutationObserver(records => {
    if (!alive) return;
    const hiddenBefore = records.some(r => ['hidden', 'inert'].includes(r.attributeName) ? r.oldValue !== null
      : r.attributeName === 'style' && /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(r.oldValue || ''));
    if (hiddenBefore) invalidate(value ? 'Last observation retained after hiding; refresh required.' : 'Activity read cancelled while hidden.');
    sync();
  }) : null;
  for (let el = section; el; el = el.parentElement) observer?.observe(el, { attributes: true, attributeFilter: ['hidden', 'inert', 'style', 'class'], attributeOldValue: true });
  const visibility = () => { if (doc.visibilityState === 'hidden') invalidate('Activity read cancelled while hidden.'); sync(); };
  doc.addEventListener('visibilitychange', visibility);
  sync();
  return { sync, read, invalidate: () => { if (alive) invalidate(value ? 'Last observation retained; refresh required.' : ''); },
    dispose() { if (!alive) return; alive = false; serial++; value = null; offCli?.(); offConnection?.(); observer?.disconnect(); doc.removeEventListener('visibilitychange', visibility); section.remove(); } };
}
