## Fixed

- **pi 1.2 and later run an instance's opening task again**
  ([#1322](https://github.com/awebai/oats/issues/1322)). From pi 1.2.0 a run
  counts as active before its `before_agent_start`, and the bridge's hold on
  the opening prompt waited for that same run. So on pi 1.2 and later, an
  instance's opening task never ran. That was the launch's `@TASK.md` in
  interactive mode, or the first default `session.prompt()` of an SDK
  session. Escape didn't release it, and every later prompt waited queued
  behind it, even after the aweb welcome's turn had finished. The hold now
  never waits for the prompt's own run, and a session that shuts down
  releases it. The task still runs once, after a welcome turn that started
  first. On pi 1.2 and later, a welcome sent while the task's run starts is
  queued by pi into that run, after the task. The bridge still sends and
  alters nothing. Restart a pi instance that hangs on its opening task once
  the updated `@awebai/oats-pi` is installed (`oats update`).
