/** Triggers (§2.3a; human 2026-09-26: a tab of its own beside Schedules). */
import { mountAutomationsPage } from "./automations.mjs";

let mounted;
export function mount(el, ctx) { mounted = mountAutomationsPage(el, ctx, "trigger"); }
export function unmount() { mounted?.dispose(); mounted = null; }
