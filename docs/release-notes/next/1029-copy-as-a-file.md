## Fixed

- **Whether a retire refuses no longer depends on the file system
  ([#1029](https://github.com/awebai/oats/issues/1029)).** A recovery copies
  the index, `info/attributes`, the stash's log and a nested repository's
  reflogs each as one file. With an empty directory at one of those paths
  the copy failed on most file systems and the retire refused, but on btrfs
  it wrote an empty file and the retire went through. Nothing was lost
  there: an empty directory at such a path holds nothing that Git reads. A
  retire now looks before it copies and refuses on every file system with
  `E_WORK_PRESERVATION_FAILED`, naming the path and what is there. A link
  at such a path is still followed, as Git follows it.
  [The rule](../souls-and-instances.md#copied-as-one-file).
