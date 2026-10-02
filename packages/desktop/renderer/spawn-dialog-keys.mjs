/* The spawn dialog's own keys (Spec E; docs/desktop-keyboard.md): Mod+Enter spawns, Mod+1–Mod+7 jump
   to a section of the form. They are actions of the `spawn-dialog-local` context: the shortcuts editor
   lists them and they can be rebound, but the window never dispatches them (that context is never
   active). The open dialog resolves them itself (resolveViewKey) and stops them there, so while it is
   open these chords are the dialog's and nothing behind the modal sees them. Registered once, for the
   app's lifetime: the shell registers them at start so the editor lists them before any dialog opens;
   the dialog's host registers them too (a no-op then), for hosts without the shell (the view harness). */
import { registerAction, parseChord } from "./keybindings.mjs";

export const SPAWN_DIALOG_CONTEXT = "spawn-dialog-local";
export const SPAWN_SUBMIT = Object.freeze({ id: "spawn.submit", label: "Spawn selected soul", defaultChord: "Mod+Enter" });
/** target: the section the dialog moves focus to (createSpawnDialog's jump()). */
export const SPAWN_JUMPS = Object.freeze([
  { id: "spawn.jumpName", target: "name", label: "Spawn dialog: go to Name", defaultChord: "Mod+1" },
  { id: "spawn.jumpHarness", target: "harness", label: "Spawn dialog: go to Harness", defaultChord: "Mod+2" },
  { id: "spawn.jumpModel", target: "model", label: "Spawn dialog: go to Model", defaultChord: "Mod+3" },
  { id: "spawn.jumpRelationship", target: "relationship", label: "Spawn dialog: go to Relationship", defaultChord: "Mod+4" },
  { id: "spawn.jumpTeams", target: "teams", label: "Spawn dialog: go to Teams", defaultChord: "Mod+5" },
  { id: "spawn.jumpTask", target: "task", label: "Spawn dialog: go to Opening instruction", defaultChord: "Mod+6" },
  { id: "spawn.toggleAdvanced", target: "advanced", label: "Spawn dialog: open or close Developer settings", defaultChord: "Mod+7" },
].map(Object.freeze));
export const SPAWN_DIALOG_KEYS = Object.freeze([SPAWN_SUBMIT, ...SPAWN_JUMPS]);

let registered = false;
/** Register the dialog's actions (idempotent). Their run is a no-op: only the open dialog dispatches them. */
export function registerSpawnDialogKeys() {
  if (registered) return;
  registered = true;
  for (const { id, label, defaultChord } of SPAWN_DIALOG_KEYS) registerAction({ id, label, context: SPAWN_DIALOG_CONTEXT, defaultChord, run: () => {} });
}

/** A chord as aria-keyshortcuts says it ("Meta+1" on macOS, "Control+1" elsewhere); "" for none. */
export function ariaKeyShortcuts(chord, isMac) {
  const c = typeof chord === "string" ? parseChord(chord) : chord;
  if (!c) return "";
  const parts = [];
  if (c.mod) parts.push(isMac ? "Meta" : "Control");
  if (c.ctrl && !(c.mod && !isMac)) parts.push("Control");
  if (c.alt) parts.push("Alt");
  if (c.shift) parts.push("Shift");
  const key = { escape: "Escape", enter: "Enter", space: "Space", tab: "Tab", arrowup: "ArrowUp", arrowdown: "ArrowDown",
    arrowleft: "ArrowLeft", arrowright: "ArrowRight", pageup: "PageUp", pagedown: "PageDown", backspace: "Backspace" }[c.key]
    || (c.key.length === 1 ? c.key.toUpperCase() : c.key[0].toUpperCase() + c.key.slice(1));
  parts.push(key);
  return parts.join("+");
}
