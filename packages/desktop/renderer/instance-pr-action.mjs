/** Explicit context-menu K1→P1 read. No per-row fetch, gh invocation, auth,
 * branch/URL synthesis, persistent cache or lifecycle/terminal action. */
import { postJson } from './views/common.mjs';
import { instanceActionTarget } from './instance-action-target.mjs';
import { gitTarget, gitTargetKey, gitState } from './instance-git-contract.mjs';
import { FORGE_API, ref, projectedPullRequest, forgeReason } from './forge-contract.mjs';
export function createInstancePrAction({ ctx, beginIntent, currentTarget, generation, connectionGeneration, report, openExternal }) {
  let serial = 0, alive = true;
  return {
    async open(value) {
      const target = instanceActionTarget(value?.workspace, { ...value, createdAt: value?.incarnation });
      if (!alive || !target || !currentTarget(target)) return;
      const ticket = ++serial, intent = beginIntent(), workspace = generation(), connection = connectionGeneration();
      const owns = () => alive && ticket === serial && intent() && workspace === generation() && connection === connectionGeneration() && currentTarget(target);
      if (!target || !owns()) return;
      if (target.server) { report('Remote pull-request inspection is unavailable; no local fallback was used.'); return; }
      const selector = { instance: target.instance, agent: target.agent, agentsRoot: target.agentsRoot, server: target.server };
      const expected = gitTarget(target);
      if (!expected) { report('Choose one current, qualified instance.'); return; }
      const request = (route, body) => postJson(ctx, `${route}?ws=${encodeURIComponent(target.workspace)}`, body);
      try {
        const git = await request('/api/instance-git', { action: 'git', selector });
        if (!owns()) return;
        const echoed = gitTarget(git?.target);
        if (git?.instanceGitApi !== 1 || git.status !== 'available' || !echoed || gitTargetKey(echoed) !== gitTargetKey(expected) || !ref(git.observationKey)) throw Error();
        const data = gitState(git.data, expected);
        if (!data) throw Error();
        const result = await request('/api/instance-forge', { selector, observationKey: git.observationKey });
        if (!owns()) return;
        const forgeTarget = gitTarget(result?.target), observation = data.observation;
        if (result?.forgeApi !== FORGE_API || !forgeTarget || gitTargetKey(forgeTarget) !== gitTargetKey(expected)
          || result.observation?.key !== git.observationKey || result.observation.revision !== observation.revision || result.observation.branch !== observation.branch) throw Error();
        if (result.status === 'no-pull-request' && result.data === null) { report('No pull request found for this branch.'); return; }
        if (result.status === 'not-connected' && result.data === null) { report('Not connected to GitHub. Use Connections to connect explicitly.'); return; }
        if (result.status !== 'available') {
          const code = typeof result.reason?.code === 'string' ? result.reason.code : 'E_GH_FAILED', reason = forgeReason(code);
          report(`Pull request unavailable: ${typeof reason.message === 'string' ? reason.message : 'GitHub CLI is unavailable.'}`); return;
        }
        const pr = projectedPullRequest(result.data, { host: result.host, path: result.repository, branch: observation.branch });
        if (!pr) throw Error();
        if (owns()) openExternal(pr.url);
      } catch { if (owns()) report('Pull request unavailable. Refresh the current instance and retry.'); }
    },
    dispose() { alive = false; serial++; },
  };
}
