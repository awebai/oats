## Changed

- **The local-only project step cleans up and checks a repository's history for files GitHub refuses.** `/oats-setup-expert` step 3's previews now remove their temporary scratch repository. For a repository with commits, it lists by name any file over 100 MB anywhere in its history, since GitHub refuses that push, and then pushes nothing and offers a fresh copy of the current files or keeping the project local ([awebai/oats#1665](https://github.com/awebai/oats/issues/1665)).
