## Fixed

- **An instance with a file over 2 GiB in its work retires**
  ([#617](https://github.com/awebai/oats/issues/617)). The retire refused such
  an instance before doing anything, with `E_WORK_INSPECTION_FAILED: ... File
  size (...) is greater than 2 GiB`. A Git clone with a large pack in a
  directory instance's `work/` was enough. The retire's digests now read
  every file in pieces of 1 MiB, and so does the verification of its recovery
  copy. A home's `instance.json`, whose stored digest leaves out the fields
  the kernel writes after spawn, is read whole up to 16 MiB; a larger one is
  hashed as it is. Otherwise a digest is the same as before for the same
  bytes, so spawn baselines stay valid. A file that shrinks while the retire
  reads it refuses the retire with `E_WORK_INSPECTION_FAILED`, `<path>
  changed while it was read`. Retry once nothing writes to it. See
  [souls-and-instances.md](../souls-and-instances.md).
