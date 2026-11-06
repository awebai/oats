#!/usr/bin/env node
// oats.aweb-tasks's binding wire (docs/capabilities.md, "Readiness check
// (`binding.check`)"). Only `check` is answered. The kernel requires a binding
// to name normalize and bind commands too, but runs neither for a tasks
// provider; they refuse as not qualified.
import { runBinding } from '../lib/binding.mjs';

await runBinding(process.argv[2]);
