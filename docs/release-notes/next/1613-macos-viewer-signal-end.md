## Fixed

- **`oats tui` on macOS closes a terminal whose viewer a signal ended.** tmux on macOS names the signal (`kill`, `hup`) where Linux's gives its number, and `oats tui` read only a number or an upper-case name, so on a Mac such a tab could stay open with nothing left in it. It now reads both ([awebai/oats#1613](https://github.com/awebai/oats/issues/1613); [What it reads, and what it runs](../tui.md#what-it-reads-and-what-it-runs)).
