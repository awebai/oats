## Changed

- **Desktop: the Workspace › Setup tab reads as one column.** The List view
  puts what the workspace shares through Git above what lives only on this
  computer. It shows the same facts as before.
  - **Under the workspace's name**, a summary counts the members (and those
    that need attention), the packages and the state of the lock. The line
    under it says where the workspace is declared, for example "Declared in
    agents's oats-workspace.yaml at 1a2b3c4."
  - **An Overview** says that the host repository defines the workspace: its
    members and its packages. **For developers**, folded, explains the two
    links that make a repository a member: the host's workspace file lists
    it, and its membership file names the workspace back. It also says what
    each member state means. The Graph view shows the Overview too. The
    legend of badges is gone.
  - **Shared through Git** holds Members, Packages and Defaults. Only the
    host's row carries a tag, **Host** with its workspace file; the Member
    tag is gone from every row. A confirmed member shows a check and
    "confirmed". Any other state keeps its warning chip. In a wide enough
    window every row takes one line.
  - **This computer** holds the deployment's folder, settings, lock, lock
    file, CLI, instances and disabled souls, then the member clones, then the
    Machines box. Instances reads "3, 1 running". The Machines box no longer
    carries a "Not shared" tag; the zone says it.
  - **The Graph view** labels read "Shared through Git", "Members, latest"
    and "Packages, pinned", in sentence case.
