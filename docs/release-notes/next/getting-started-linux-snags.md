## Changed

- **The `oats-getting-started` skill covers two Linux snags from a rehearsal.**
  With NodeSource's Node under `/usr`, it sets a per-user npm prefix and now
  also puts `~/.local/bin` on PATH for its own later commands and asks the
  person to add it to their shell's startup file. Without FUSE (Ubuntu 22.04
  and later), it names `libfuse2` (`libfuse2t64` on Ubuntu 24.04) as the
  install, beside the `--appimage-extract-and-run` fallback.
