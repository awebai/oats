## Changed

- **Desktop: the active terminal tab's instance is always shown in the
  sidebar.** When another terminal tab becomes active (a click on a tab,
  Ctrl+Tab, go to tab, closing a tab, focusing another split group), the
  instance list scrolls just enough to show that instance's row and marks it
  selected at once. A click on the tab that is already active does the same.
  Focus stays where it was. The list does not move while the sidebar is hidden
  or in focus mode, or when your filter hides the row. A row under a collapsed
  parent shows its parent's row instead, and the parent stays collapsed.
