/** The Teams section of the terminal-side context panel's Instance tab: the
 * compact presentation of the Workspace inspector's card (teams-panel.mjs,
 * `compact: true`), for the focused terminal's instance. The context panel
 * stays IO-free — this section is injected like the Git panel and owns its
 * reads: `oats inspect --home` (which operations the messaging provider
 * declares), then the provider's `messaging:teams|join|leave`. Every await
 * carries the selection identity, the workspace generation and a serial,
 * checked on success and rejection. `tools`, when given, is the section
 * header's right-hand slot: the icon Refresh goes there and leaves with the
 * panel (a new selection, or dispose).
 *
 * Loading (desktop/loading-states item 8): the section's header (the context
 * panel's, roster-derived) stays put and the body below it carries the state —
 * a skeleton of compact team rows after 150ms while the inspection runs, the
 * failed block with Retry when it fails, the card when it lands; nothing is
 * prepended above. The section claims its place during the inspection only
 * when the roster row already says messaging applies (`identityAddress`), and
 * never again for a subject whose inspection found no provider: a section that
 * appeared and vanished would shift Lineage under it. An instance whose status
 * identity changes (a restart, drift) re-reads: the card refreshes its list, or
 * the inspection runs again.
 *
 * An instance on a registered server is read through the same route by its
 * deployment, server and home; a row that can't be routed from here sends
 * nothing and claims the place to say why, as a failure does, and a host's
 * refusal is shown as relayed (remote-address.mjs). */
import { inspectData, inspectSupported } from '../../client/inspect-contract.mjs';
import { createTeamsPanel, teamsCSS, teamsOperations } from './teams-panel.mjs';
import { cliStatus } from './views/cli-status.mjs';
import { createDataState, statusLine } from './loading.mjs';
import { instanceStatusIdentity } from './instance-status-identity.mjs';
import { relayedFailure, remoteInspectBlock, serverLabel } from '../../client/remote-address.mjs';

export { teamsCSS };

export function createInstanceTeamsSection(host, { request, generation = () => 0, onPresence = () => {}, cli = cliStatus, tools = null } = {}) {
  const doc = host.ownerDocument, win = doc.defaultView;
  let identity = null, statusId = null, serial = 0, panel = null, disposed = false, attempted = null, current = null, noProvider = false;
  const node = cls => { const el = doc.createElement('div'); el.className = cls; return el; };
  const status = statusLine(doc, { visuallyHidden: true, className: 'instance-teams-status' });
  const body = node('instance-teams-body');
  host.append(status, body);
  const loading = createDataState({ doc, noun: 'teams', region: body, skeletonHost: body, failedHost: body, skeleton: () => skeletonRows(), status,
    indicatorHost: null, noticeHost: null, onRetry: () => { if (current && identity) void load(current.workspace, current.instance, identity, { user: true }); },
    // A focused Retry whose block leaves on success lands on the card's Refresh (the tools slot, or the card) when it can
    // take focus (the card's first read holds it disabled), else the section's head (made focusable for it), never on <body>.
    focusFallback: () => {
      const refresh = tools?.querySelector('button.teams-refresh') || body.querySelector('button.teams-refresh');
      if (refresh && !refresh.disabled) return refresh;
      const head = host.querySelector('.context-panel-section-head'); if (head && !head.hasAttribute('tabindex')) head.tabIndex = -1; return head;
    },
    setTimeout: (fn, ms) => win.setTimeout(fn, ms), clearTimeout: id => win.clearTimeout(id) });
  const clear = () => { panel?.dispose(); panel = null; body.querySelector('.teams-panel')?.remove(); loading.reset(); onPresence(false); };
  /** Pending: three compact team rows, wearing the card's classes so teams-panel.mjs's CSS gives their height. */
  function skeletonRows() {
    const bone = cls => { const el = doc.createElement('span'); el.className = `skeleton ${cls}`; el.setAttribute('aria-hidden', 'true'); return el; };
    const root = node('teams-panel is-compact instance-teams-skeleton'); root.setAttribute('aria-hidden', 'true'); root.dataset.skeleton = 'team-rows';
    const card = node('teams-card');
    for (let i = 0; i < 3; i++) {
      const row = node('team-row'), main = node('team-main');
      main.append(bone('skeleton-line skeleton-team-name'));
      row.append(bone('team-glyph skeleton-glyph'), main, bone('skeleton-line skeleton-team-state'));
      card.append(row);
    }
    root.append(card);
    return root;
  }
  /** Why the selection's current row can't be routed from here, or null (a local row never is). Checked before
   * every request, the card's included: the row and this computer's OATS may have changed since it was built. */
  const routeBlock = () => remoteInspectBlock(current?.instance, cli());
  // A remote row that can't be routed from here: nothing is sent (Retry included); the reason claims the place.
  // A card already on screen goes first (this controller has no stale line to keep it under): the failed block
  // takes its place, and focus that was in it moves to the block's Retry, never to <body>.
  function showBlocked(blocked) {
    const focused = host.contains(doc.activeElement) || !!tools?.contains(doc.activeElement);
    if (panel || loading.hasData) { panel?.dispose(); panel = null; body.querySelector('.teams-panel')?.remove(); loading.reset(); }
    loading.fail(blocked); onPresence(true);
    if (focused && !host.contains(doc.activeElement)) body.querySelector('.loading-retry')?.focus({ preventScroll: true });
  }
  async function load(workspace, instance, id, { user = false } = {}) {
    const ticket = ++serial, gen = generation();
    const owns = () => !disposed && ticket === serial && identity === id && generation() === gen;
    const selector = { home: instance.home };
    const blocked = remoteInspectBlock(instance, cli());
    if (blocked) { showBlocked(blocked); return; }
    // Claim the section now only when the roster says messaging applies here, or a failure is on screen to retry;
    // a re-read after a no-provider answer (loading.hasData, no panel) stays hidden.
    const known = loading.state === 'failed' || !!panel;
    const claim = known || (!noProvider && !loading.hasData && typeof instance.identityAddress === 'string' && instance.identityAddress);
    loading.begin({ user }); if (claim) onPresence(true);
    let result;
    try { result = await request(workspace, { action: 'inspect', selector, ...(user ? { refresh: true } : {}) }); }
    catch (error) { if (owns()) { loading.fail(instance.server ? relayedFailure(error, serverLabel(instance), 'teams') : error); onPresence(true); } return; } // visible: the failed block and Retry, never a silent absence
    if (!owns()) return;
    // The row stopped being routable while the inspection ran (an inactive tab gets no update): no card, no read.
    const late = routeBlock();
    if (late) { showBlocked(late); return; }
    const inspected = inspectData(result, { instance, selector });
    if (!inspected) {
      loading.fail(new Error(result?.operationsApi === 1 ? 'This workspace still uses the classic layout, which answers an older inspection.'
        : 'The installed OATS CLI returned an inspection this Desktop cannot read. Update OATS and retry.'));
      onPresence(true); return;
    }
    // No messaging provider: no section (a truthful absence, said by hiding it).
    const operations = teamsOperations(inspected), observedAt = typeof result?.observedAt === 'string' ? result.observedAt : null;
    // No provider is a settled absence, not data: the read ends (cancel) without a claim, so a later failed re-read
    // is the failed block with Retry — never a bare header over an empty body (a stale line has nowhere to go here).
    if (!operations) { noProvider = true; loading.cancel(); onPresence(false); return; }
    noProvider = false;
    // The card first, then succeed(): a focused Retry in the leaving failed block lands on the card's Refresh.
    panel?.dispose(); body.querySelector('.teams-panel')?.remove();
    // The card's provider operations go by the same route; a host's refusal shows as relayed. While the current
    // row can't be routed from here its controls hold, and any request it still makes (a re-read after a refused
    // join, say) is refused here, unsent, with the reason; the next active update() replaces the card.
    const label = serverLabel(instance);
    panel = createTeamsPanel(body, { operations, selector, heading: false, owns, compact: true, refreshHost: tools,
      request: body => {
        const late = routeBlock();
        if (late) return Promise.reject(late);
        return request(workspace, body).catch(error => { throw instance.server ? relayedFailure(error, label, 'teams') : error; });
      },
      available: () => inspectSupported(cli()) && !routeBlock() });
    loading.succeed({ observedAt }); onPresence(true);
  }
  return {
    /** active: the Instance tab is the visible page. A new selection resets; an
     * inactive panel keeps its last state (no background reads). The same selection
     * with another status identity (a restart, drift) re-reads: the card's list, or the
     * inspection when there is no card yet. */
    update({ active, workspace, instance } = {}) {
      if (disposed) return;
      // A remote row's identity includes its server (the same home on two servers is two subjects).
      const id = !instance?.home ? null : instance.server ? JSON.stringify([workspace, instance.server, instance.home])
        : JSON.stringify([workspace, instance.home]);
      if (id !== identity) { identity = id; attempted = null; statusId = null; noProvider = false; serial++; clear(); }
      current = id ? { workspace, instance } : null;
      // One inspection per selection (renders are frequent); a new selection reads again.
      if (!active || !id || !inspectSupported(cli())) { panel?.sync(); return; }
      const sid = instanceStatusIdentity(instance);
      // A card for a row that can no longer be routed from here (it left the host's list, or this computer's
      // OATS lost remote operations) is replaced by the reason at once, whatever the status identity says.
      if (panel && routeBlock()) { attempted = id; statusId = sid; void load(workspace, instance, id); return; }
      if (attempted === id && sid === statusId) { panel?.sync(); return; }
      const changed = attempted === id; attempted = id; statusId = sid;
      if (changed && panel) { panel.refresh(); return; }
      void load(workspace, instance, id);
    },
    dispose() { disposed = true; serial++; clear(); loading.dispose(); },
  };
}
