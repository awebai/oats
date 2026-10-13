## Changed

- **Desktop: the Spawn dialog no longer has a sentence of its own for
  `E_REQUIREMENT_INACTIVE`**
  ([#1047](https://github.com/awebai/oats/issues/1047)). This is seen only
  with an OATS of the 0.25 line, which the Desktop accepts from 0.25.8 and
  which still refuses a spawn with this code when something the soul requires
  is not active. The dialog read "Something this soul needs isn't set up yet.
  Check the soul in the Workspace view." It now reads its general sentence,
  "OATS couldn't work out this soul's defaults. Try again, or see Details.",
  and OATS's own message, which names the soul, the layer and the remedy, is
  under Details with the code. No OATS from 0.26.0 raises the code.
