## Fixed

- **Desktop: a retired instance's tabs close**
  ([#1237](https://github.com/awebai/oats/issues/1237)). When a roster read
  shows an instance retired, whether the Desktop, the CLI, another agent or
  another machine retired it, every tab of that instance closes, in every
  split. The next tab becomes active, and the focus moves only if it was in
  a closed tab. A remote instance's tabs close only when its server answers
  without it, never because the server can't be reached. Stopping an
  instance still leaves its tab open, and an instance respawned under the
  same name opens a new tab.
- **Desktop: a tab no longer shows another instance's terminal**
  ([#1237](https://github.com/awebai/oats/issues/1237)). With tmux's
  `detach-on-destroy off` in your configuration, retiring an instance moved
  its tab to another session, often another tab's agent: the tab kept its
  name, and what you typed went to that agent. The tab's terminal now ends
  ("session ended") when its instance's window goes. Only the Desktop's own
  viewer sessions are set this way; your global option and your own
  sessions are untouched.
