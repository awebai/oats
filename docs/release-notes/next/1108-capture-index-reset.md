## Changed

- Add private capture foundations for separately admitted atomic index reset
  and resumable inventory restart. A fresh worker performs the reset; a durable
  index token lets a replacement finish sweep publication without repeating a
  committed reset. Union failures retain stream retry evidence and defer repeat
  attempts. These helpers do not yet enable installed periodic capture or
  establish complete command/service qualification.
