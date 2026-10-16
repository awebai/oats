## Changed

- Add the private finite capture service entry with explicit service attribution,
  validated caller selection and worker-receipt-only result reporting, plus pure
  marked periodic definitions for launchd and systemd. The definitions specify
  15-minute scheduling and the fixed Linux process limits. Ownership-safe setup
  conversion uses these definitions through a separate preflight/apply gate.
  Rendering alone does not install or start a service; hosted manager
  qualification remains separate.
