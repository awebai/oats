## Changed

- **Desktop: an OATS Desktop older than the installed `oats` CLI says so, and
  offers no downgrade** ([#1107](https://github.com/awebai/oats/issues/1107)).
  When the CLI it finds is a released version above the range the Desktop
  works with (usually because the CLI was updated first), the card reads "This
  Desktop is older than the installed `oats` CLI" and names the OATS Desktop
  version to install. It no longer offers `npm install -g @awebai/oats@<the
  Desktop's version>`, which would have downgraded the CLI. **Choose oats…**,
  **Retry** and the docs link stay, and reads and terminals keep working
  meanwhile. For a CLI below the range, a prerelease, or any other refusal, the
  card is as before. [OATS Desktop](../desktop.md#troubleshooting) has the
  card's states.
