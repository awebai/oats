/** Stable stage-facing facade over workspace-epoch-bound presentation leases.
 * The view owns content and async generations; the shell alone selects foreground.
 * Renewal never rebuilds retained DOM and disposal never reacquires a lease. */
export function createPanelOwner(panel, owner, generation) {
  let closed = false;
  const attachments = new Set();
  return {
    attach(element) {
      let lease = null, epoch = null, released = false;
      const current = () => {
        if (closed || released) return null;
        const next = generation();
        if (!lease || epoch !== next) { lease = panel.attach(owner, element); epoch = next; }
        return lease;
      };
      current();
      const facade = {
        setPresent(value) { current()?.setPresent(value); },
        // Visibility queries must not renew/reveal an old workspace's content.
        isVisible: () => !closed && !released && epoch === generation() && !!lease?.isVisible(),
        collapse() { if (!closed && !released && epoch === generation()) lease?.collapse(); },
        dispose() { if (released) return; released = true; lease?.dispose(); attachments.delete(facade); },
      };
      attachments.add(facade);
      return facade;
    },
    dispose() {
      if (closed) return;
      closed = true;
      for (const attachment of [...attachments]) attachment.dispose();
      panel.release(owner);
    },
  };
}
