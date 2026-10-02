// The globals main's api handler uses for window-bound requests (#481), for tests that run the shipped
// handler in a vm. A test's own values win; `advertisedNow` reads the context's live allowedWs (the
// handler reassigns it), else its advertisedBefore, as main does.
import { frameWorkspace } from '../../renderer/window-binding.mjs';
import { windowRefusal } from '../../api-url.mjs';
import { workspaceNotServed } from '../../renderer/deployment-header.mjs';

export function withWindowGlobals(context) {
  return Object.assign(context, {
    frameWorkspace, windowRefusal, workspaceNotServed, noteServed() {}, panelWorkspaces: async () => null, servedList: [],
    advertisedNow: () => (context.allowedWs?.size ? context.allowedWs : context.advertisedBefore ?? new Set()),
  }, Object.fromEntries(['frameWorkspace', 'windowRefusal', 'workspaceNotServed', 'noteServed', 'advertisedNow', 'panelWorkspaces', 'servedList']
    .filter((name) => Object.hasOwn(context, name)).map((name) => [name, context[name]])));
}
