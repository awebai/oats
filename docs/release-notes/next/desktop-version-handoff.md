## Fixed

- **Desktop: opening a new version while an older one runs says so.**
  Installing a new Desktop (an AppImage, a DEB, another copy) while an older
  one was running used to open a window of the old one, silently: the new
  version's features seemed missing. Now the running Desktop opens or focuses
  the window as before, then says which version you opened and which is still
  running, and offers **Restart into** the new one (it closes Desktop's
  windows and starts the version you opened; your agents keep running in their
  sessions) or **Keep** the running one. When the copy you opened can't be
  started again, it says to quit Desktop and open it again. This takes effect
  once the running Desktop is this version or later: an older running Desktop
  still opens its own window, so quit it once, by hand
  ([desktop.md](../desktop.md#updating)).
