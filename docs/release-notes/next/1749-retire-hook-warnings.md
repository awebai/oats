## Added

- **A retire hook's warnings stay readable after the retire, as `retire-warning`
  events** (oats-project/oats#1749). A retire hook can succeed and still name
  an action someone must take. Until now that warning was only in the retire's
  answer, and was lost once the caller moved on.
  - Each warning of the retire hooks is now one `retire-warning` row, `data:
    {message}`, in the instance's workspace log. `oats instance events
    <instance> --json` reads it after the home is gone.
  - The rows are written as soon as the hooks return. A retire that then
    refuses or ends quarantined keeps them, and each retry of the hooks adds
    its own.
  - A retire whose hooks warn nothing writes none. The retire's answer and the
    `retired` event are unchanged. Older clients read the new kind as an
    unknown kind
  ([Events](../desktop-cli-api.md#events)).

## Changed

- **A `launch-warning` or `retire-warning` row stores its message made safe
  and bounded** (oats-project/oats#1749). Control, bidi and hidden characters
  are replaced with U+FFFD, and the text is cut to 2048 UTF-16 code units
  ending in `…`. A warning that is not a string is stored as its JSON. The row
  shape is unchanged, and the answers' `warnings` keep each warning as it was said
  ([Events](../desktop-cli-api.md#events)).
