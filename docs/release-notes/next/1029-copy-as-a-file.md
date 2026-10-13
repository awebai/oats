## Changed

- **On btrfs, a retire that went through with an empty directory where its
  recovery copies one file is now refused
  ([#1029](https://github.com/awebai/oats/issues/1029)).** With an empty
  directory at `info/attributes`, at the stash's log or at the log of a
  nested repository's branch, `oats retire` completed there. It now answers
  `E_WORK_PRESERVATION_FAILED`, the code every other file system already
  gave for it. On every file system, such a path whose parent directory
  cannot be searched is refused the same way, where it was left out of the
  copy. See the entry under Fixed.

## Fixed

- **Whether a retire refuses no longer depends on the file system
  ([#1029](https://github.com/awebai/oats/issues/1029)).** A recovery copies
  the index, `info/attributes`, the stash's log and a nested repository's
  reflogs each as one file. With an empty directory at one of the last three
  the copy failed on most file systems and the retire refused, but on btrfs
  it wrote an empty file and the retire went through. Nothing was lost
  there: an empty directory at such a path holds nothing that Git reads. A
  retire now looks before it copies and refuses on every file system with
  `E_WORK_PRESERVATION_FAILED`, naming the path and what is there. A link
  at such a path is still followed, as Git follows it.
  [The rule](../souls-and-instances.md#copied-as-one-file).
