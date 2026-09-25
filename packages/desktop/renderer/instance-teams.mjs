/** The Teams section of the terminal-side context panel's Instance tab: the
 * same card as the Workspace inspector's (teams-panel.mjs), for the focused
 * terminal's instance. The context panel stays IO-free — this section is
 * injected like the Git panel and owns its reads: `oats inspect --home`
 * (which operations the messaging provider declares), then the provider's
 * `messaging:teams|join|leave`. Every await carries the selection identity,
 * the workspace generation and a serial, checked on success and rejection. */
import { inspectData, inspectSupported } from './inspect-contract.mjs';
import { createTeamsPanel, teamsCSS, teamsOperations } from './teams-panel.mjs';
import { cliStatus } from './views/cli-status.mjs';

export { teamsCSS };

export function createInstanceTeamsSection(host, { request, generation = () => 0, onPresence = () => {}, cli = cliStatus } = {}) {
  let identity = null, serial = 0, panel = null, disposed = false, attempted = null;
  const clear = () => { panel = null; host.querySelector('.teams-panel')?.remove(); onPresence(false); };
  async function load(workspace, instance, id) {
    const ticket = ++serial, gen = generation();
    const owns = () => !disposed && ticket === serial && identity === id && generation() === gen;
    const selector = { home: instance.home };
    let inspected = null;
    try { inspected = inspectData(await request(workspace, { action: 'inspect', selector }), { instance, selector }); } catch { inspected = null; }
    if (!owns()) return;
    // No messaging provider (or an inspection this Desktop cannot read): no section.
    const operations = inspected && teamsOperations(inspected);
    if (!operations) return;
    onPresence(true);
    panel = createTeamsPanel(host, { operations, selector, heading: false, owns,
      request: body => request(workspace, body), available: () => inspectSupported(cli()) });
  }
  return {
    /** active: the Instance tab is the visible page. A new selection resets; an
     * inactive panel keeps its last state (no background reads). */
    update({ active, workspace, instance } = {}) {
      if (disposed) return;
      const id = instance?.home && !instance.server ? JSON.stringify([workspace, instance.home]) : null;
      if (id !== identity) { identity = id; attempted = null; serial++; clear(); }
      // One inspection per selection (renders are frequent); a new selection reads again.
      if (!active || !id || attempted === id || !inspectSupported(cli())) { panel?.sync(); return; }
      attempted = id;
      void load(workspace, instance, id);
    },
    dispose() { disposed = true; serial++; clear(); },
  };
}
