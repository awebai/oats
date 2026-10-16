## Changed

- Add the private finite capture service entry with explicit service attribution,
  validated caller selection and worker-receipt-only result reporting, plus pure
  marked periodic definitions for launchd and systemd. The definitions specify
  15-minute scheduling and the fixed Linux process limits. Setup still uses its
  legacy installer; ownership-safe conversion, activation and hosted manager
  qualification remain separate work. Rendering does not install or start a service.
