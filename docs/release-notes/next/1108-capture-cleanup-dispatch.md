## Changed

- Extend the private bounded-capture worker foundations with retained cleanup
  dispatch, allocation-specific interruption backoff and cleanup progress joined
  to its metadata commit. Healthy capture/index work can continue after cleanup
  failure without erasing its run history or unrelated stream retries. These
  foundations do not yet change ordinary capture commands or installed service
  behavior; cleanup enumeration is not proof of a completed capture pass.
