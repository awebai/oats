// A drop belongs to the pane under the pointer, including an unfocused split.
// Clipboard text remains xterm's job; clipboard images use the same file path.
export function attachmentText(paths) {
  return paths.map(path => `'${path.replace(/'/g, `'\\''`)}'`).join(" ") + " ";
}
export function wireTerminalAttachments({ wrap, desk, term, ptyId }) {
  let alive = true, busy = false;
  const status = wrap.ownerDocument.createElement("div");
  status.className = "term-attachment-status";
  status.setAttribute("role", "status"); status.hidden = true;
  wrap.append(status);
  const show = text => { status.textContent = text; status.hidden = !text; };
  const attach = async files => {
    if (busy) { show("Wait for the current attachments to finish."); return; }
    const id = ptyId(); if (id === null) return;
    busy = true; show("Attaching files…");
    try {
      const paths = await desk.termAttachFiles(id, files);
      if (!alive || ptyId() !== id) return;
      term.paste(attachmentText(paths)); // honors the harness's bracketed-paste mode
      term.focus(); show("");
    } catch (e) { if (alive) show(`Could not attach: ${e.message || e}`); }
    finally { busy = false; }
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
  return () => { alive = false; wrap.removeEventListener("dragover", drag); wrap.removeEventListener("drop", drop); wrap.removeEventListener("paste", paste, true); status.remove(); };
}
