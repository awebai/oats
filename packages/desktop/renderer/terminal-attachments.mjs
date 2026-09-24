// A drop belongs to the pane under the pointer, including an unfocused split.
// Clipboard text remains xterm's job; clipboard images use the same file path.
import { terminalHandle, terminalSameHandle, terminalFailure } from './terminal-contract.mjs';
export function attachmentText(paths) {
  return paths.map(path => `'${path.replace(/'/g, `'\\''`)}'`).join(" ") + " ";
}
export function wireTerminalAttachments({ wrap, desk, term, ptyId, ownsFocus = () => false }) {
  let alive = true, busy = false, operation = 0;
  const status = wrap.ownerDocument.createElement("div");
  status.className = "term-attachment-status";
  status.setAttribute("role", "status"); status.hidden = true;
  wrap.append(status);
  const show = text => { status.textContent = text; status.hidden = !text; };
  const attach = async files => {
    if (busy) { show("Wait for the current attachments to finish."); return; }
    const id = terminalHandle(ptyId()); if (!id) return;
    const generation = ++operation;
    const current = () => alive && operation === generation && terminalSameHandle(ptyId(), id);
    busy = true; show("Attaching files…");
    try {
      const result = await desk.termAttachFiles(id, files);
      if (!current()) return;
      if (result?.terminalApi !== 2 || !result.ok || !Array.isArray(result.paths)) {
        show(terminalFailure(result?.code || 'E_TERM_ATTACHMENT_FAILED').message); return;
      }
      term.paste(attachmentText(result.paths)); // honors bracketed-paste; never submits
      if (ownsFocus()) term.focus();
      show("");
    } catch { if (current()) show(terminalFailure('E_TERM_ATTACHMENT_FAILED').message); }
    finally { if (operation === generation) busy = false; }
  };
  const drag = e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } };
  const drop = e => {
    const files = [...(e.dataTransfer?.files || [])]; if (!files.length) return;
    e.preventDefault(); e.stopPropagation(); void attach(files);
  };
  const paste = e => {
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault(); e.stopImmediatePropagation(); void attach(files);
  };
  wrap.addEventListener("dragover", drag); wrap.addEventListener("drop", drop);
  wrap.addEventListener("paste", paste, true);
  return () => { alive = false; operation++; wrap.removeEventListener("dragover", drag); wrap.removeEventListener("drop", drop); wrap.removeEventListener("paste", paste, true); status.remove(); };
}
