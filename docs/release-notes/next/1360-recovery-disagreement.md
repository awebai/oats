## Changed

- A retire that refuses because the worktree recovery copy disagrees with the
  source (`E_WORK_PRESERVATION_FAILED`, `worktree recovery verification
  disagreed with the source`) now says where. `details.recoveryDisagreement`
  lists up to 20 escaped relative paths, each with a fixed kind (`missing`,
  `extra`, `type`, `mode`, `link-target`, `file-content`), and the message
  names the first 5. The refusal is still decided by the exact digest
  comparison, and nothing else changes: no hook runs, nothing is deleted and
  the staged copy is removed as before. The report is read afterwards, from
  the source and the copy as they are then, so it is a diagnosis, not a
  verdict. Its search is bounded (entries, bytes read and 5 seconds) and says
  when it stopped early. No content, link target or absolute path is
  reported. See [the retire errors](../desktop-cli-api.md#retire) (#1360).
