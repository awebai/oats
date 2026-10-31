## Changed

- **The macOS installers are built on `macos-15`.** GitHub retires `macos-14` on 2026-11-02, so `release.yml`, `build-installers.yml`, the macOS test run and the TUI's macOS tests move to it. The installers' targets and signing don't change, and the x64 installer is still cross-built and smoke-tested under Rosetta.
