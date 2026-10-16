## Changed

- Add a private normal-worker all-stage audit before capture completion receipts,
  including current index evidence, source outcomes, outstanding admissions,
  retries and cleanup. Newly arrived streams remain processing work; interrupted
  audits cannot certify success. Source-sweep retirement waits for the published
  final receipt, and later sweeps renew index discovery. These foundations and
  fixture assertions do not switch ordinary commands or the installed service;
  final Linux/storage/manager qualification remains required.
