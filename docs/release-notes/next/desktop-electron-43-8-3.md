## Fixed

- **Desktop: Electron 43.8.3, from 43.2.0, for Electron's security fixes.**
  It carries the fixes for
  [CVE-2026-102674](https://github.com/electron/electron/security/advisories/GHSA-gr2m-v5gq-v685)
  (windows opened from a sandboxed top-level document did not inherit its
  sandbox restrictions; fixed in 43.4.1) and
  [CVE-2026-102677](https://github.com/electron/electron/security/advisories/GHSA-qmv3-fv6v-rmhq)
  (the sandboxed preload code cache did not check that a cached entry matched
  its preload; first released in 43.5.0), the block of the compromised
  eMudhra intermediate certificates
  ([GHSA-jr5w-w6x2-84p9](https://github.com/electron/electron/security/advisories/GHSA-jr5w-w6x2-84p9),
  43.8.1), and the other Electron advisories fixed on the 43 line since
  43.2.0. Neither CVE was reachable in the Desktop: it refuses every window a
  page tries to open, its windows load only its own local files, and its
  preload does not run sandboxed. Electron 43.8.3 bundles Node.js 24.22.0, so
  the Node.js security release of 2026-10-21 (24.22.1) is not in it yet. The
  Desktop's own code on that Node.js, its main process and its backend, makes
  no TLS, DNS or outbound network connections: it reaches its backend over
  127.0.0.1 only.
