/** Keyboard-accessible lifecycle actions, independent of whether a terminal is running. */
import { instanceId } from "./instance-tree.mjs";

const pending = new Map(); // pending key -> controls created during the action

export function instanceActions(doc, instance, { invoke, confirmRetire, done, report }) {
  const key = instanceId(instance);
  const select = doc.createElement("select");
  select.className = "ctx-instance-actions";
  select.dataset.treeInstance = key;
  select.dataset.treeControl = "actions";
  select.setAttribute("aria-label", `Actions for ${instance.instance}${instance.server ? ` on ${instance.server}` : ""}`);
  for (const [value, text] of [["", "⋯"], ["harvest", "Harvest knowledge"], ["retire", "Retire instance"]]) {
    const option = doc.createElement("option"); option.value = value; option.textContent = text; select.append(option);
  }
  const unrouted = !!instance.server && !instance.savedRoute;
  select.disabled = unrouted || pending.has(key);
  pending.get(key)?.push({ select, unrouted });
  if (unrouted) select.title = "No saved route for this remote instance on this machine";
  select.addEventListener("change", async () => {
    const action = select.value; select.value = "";
    if (!action || select.disabled || pending.has(key)) return;
    if (action === "retire" && !confirmRetire(instance)) return;
    pending.set(key, [{ select, unrouted }]);
    select.disabled = true;
    try { const result = await invoke(action, instance); done(result, action); }
    catch (e) { report(e.message, e.result); }
    finally {
      for (const control of pending.get(key) || []) control.select.disabled = control.unrouted;
      pending.delete(key);
    }
  });
  return select;
}
