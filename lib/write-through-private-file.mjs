/** The one writer of a file the kernel writes through a private file beside it (awebai/oats#1076).
 *  The rule, decided on awebai/oats#963: a private file is removed when its write or its rename
 *  fails, and the error answered is that failure's. A file system with no space makes the file and
 *  has no block for its bytes; nothing else would remove it, and each later attempt would leave one
 *  more. Dependency-free and synchronous, as every caller is.
 *
 *  What differs between callers stays theirs to give: the private file's name (`<path>.tmp-<pid>`
 *  for most, a nonce or a leading dot for some: two processes writing one path never share it),
 *  the bytes (each makes its own JSON), and the mode the private file is created with. No caller
 *  syncs today, and this adds none. A caller that needs more than this (an exclusive create through
 *  a link, an exact mode, a failed removal reported) keeps its own code. */
import { renameSync, rmSync, writeFileSync } from "node:fs";

/** Write `bytes` to `privatePath`, created with `mode` when one is given (as writeFileSync applies
 *  it: on creation, less the umask), and rename it over `path`. When the write or the rename fails,
 *  the private file is removed and that failure's error is thrown; a failure of the removal itself
 *  is not answered. */
export function writeThroughPrivateFile(path, privatePath, bytes, mode) {
  try {
    writeFileSync(privatePath, bytes, mode !== undefined ? { mode } : undefined);
    renameSync(privatePath, path);
  } catch (e) {
    try { rmSync(privatePath, { force: true }); } catch { /* the first error is the one answered */ }
    throw e;
  }
}
