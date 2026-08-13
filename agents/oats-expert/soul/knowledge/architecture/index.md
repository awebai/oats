# Architecture

* [What OATS is](what-oats-is.md) - The Open Agent Team Specification pattern — durable souls, disposable instances, harvest-back — and the claim it makes.
* [The oats implementation](implementation.md) - The reference implementation — universal CLI/kernel, targetable capability packages, exact instance-local pi/Claude composition, and locked/trusted executable surfaces.
* [Memory design](memory-design.md) - Three memory kinds — skills (how), knowledge (what/why), state (where am I).
* [Knowledge typology](knowledge-typology.md) - How OKF types map to souls vs instances — invariance vs indexicality, consolidation stages, core vs role-grown.
* [Workspace config (superseded)](workspace-config.md) - Historical .agents/workspace.yaml design, removed before the first public capability-package contract in favor of scoped oats-config.yaml.
* [oats-config](oats-config.md) - The scoped oats-config.yaml model — agent-types with soul-declared membership, exclusive layer slots + additive capabilities, from provenance, injection overrides, CLI-authored config.
* [Skill layering](skill-layering.md) - The content-layer rule for always-loaded instructions, on-demand skills, and index-first knowledge, plus exact capability-selected instance distribution.
