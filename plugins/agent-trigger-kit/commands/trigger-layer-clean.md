---
description: Find or remove orphan generated trigger-layer wrappers after task changes.
---

# Trigger Layer Clean Command

Use this when invoking `/trigger-layer-clean`. The maintained workflow lives in
`skills/cross-agent-trigger-layer/SKILL.md`.

## Arguments

`$ARGUMENTS`

## Delegation

Apply the `agent-trigger-kit:cross-agent-trigger-layer` skill before answering
or acting.

- Prefer `agent-trigger-kit clean --root <project> --plugin <plugin-name>` for
  the first pass so cleanup starts as a dry-run.
- Add `--apply` only after the orphan paths are clear and cleanup was requested.
- Treat markerless files as hand-rolled project content; leave them on disk.
