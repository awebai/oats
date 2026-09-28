---
name: accessible-desktop-interactions
description: "Use when designing or reviewing OATS Desktop tabs, keyboard actions, filtered selection, asynchronous dialogs, native pickers, focus restoration or accessibility regressions."
---

# Verify interaction ownership, not just appearance

1. Identify the user action, current workspace/host/instance, focus owner and busy state. Consult the Desktop external index for intent; read current renderer/test contracts before reusing historical behavior.
2. Keep one semantic tab trigger per item, a named tabpanel and a single selected tab stop per group. Exercise Arrow/Home/End traversal and close succession within the group. Structural traversal is not a second rebindable shortcut map.
3. Compare visible shortcut hints and pointer controls with the effective action binding, including explicit unbinds and rebinding. Test editable fields, native selects and terminal input; a no-op after preventDefault still consumes the key. Review platform-resolved terminal control-byte collisions.
4. For a non-dismissible busy mutation, park focus on an internal programmatic status target, keep Tab inside, guard alternate handler entry points, and restore the initiating control on recoverable failure. Disabled buttons alone are not a focus strategy.
5. Separate discovery, picker and mutation lifetimes. A canceled picker may reveal still-owned discovery results. A completed effect needs reconciliation even when its original view is gone.
6. For custom listbox/radio selection, provide one tab stop and roving Arrow/Home/End behavior. Filtering must invalidate a hidden submitted choice. Preserve focus by stable identity when repainting, not merely by element position.
7. Check contrast and focus indicators against resolved foreground/background tokens in every supported theme, including selected, disabled and busy states. Relationship meaning must not rely on color alone. Record measured ratios and the actual accessibility target; do not claim a full accessibility audit from a screenshot.

## Verification loop

Run targeted tests from `packages/desktop` with `node --test test/<selected>.test.mjs`, then the package's `npm test` when the authorized scope requires it. Inspect tests before choosing them. Force late success and late failure with deferred responses; attempt keyboard and synthetic handler entry while busy. Include real keyboard/native picker/screen-reader checks for claims DOM tests cannot prove; use electron-live-verification for terminal-native claims.

Report the exact sequence, focused element and submitted identity before/after, tests and live checks executed, and any unavailable platform/assistive-technology coverage. A source regex is only a wiring check, not user evidence.
