/** Keyboard-accessible lifecycle actions, independent of whether a terminal is running. */
import { instanceId } from "./instance-tree.mjs";

const pending = new Set(); // survives roster rebuilds while a lifecycle command runs

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
  if (unrouted) select.title = "No saved route for this remote instance on this machine";
  select.addEventListener("change", async () => {
    const action = select.value; select.value = "";
    if (!action || select.disabled || pending.has(key)) return;
    if (action === "retire" && !confirmRetire(instance)) return;
    pending.add(key);
    select.disabled = true;
    try { const result = await invoke(action, instance); done(result, action); }
    catch (e) { report(e.message, e.result); }
    finally { pending.delete(key); select.disabled = unrouted; }
  });
  return select;
}
