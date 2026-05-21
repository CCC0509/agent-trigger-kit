---
description: Validate a project-local cross-agent trigger layer for drift and manifest errors.
---

# Trigger Layer Validate Command

Use this when invoking `/trigger-layer-validate`. The maintained workflow lives in `skills/cross-agent-trigger-layer/SKILL.md`.

## Arguments

`$ARGUMENTS`

## Delegation

Apply the `agent-trigger-kit:cross-agent-trigger-layer` skill before answering or acting.

- Run the bundled validator against the target project.
- Report manifest, skill, command, Cursor rule, and pointer-doc drift separately.
- Report configured document header failures as `MISSING header in <file>
  (check: <name>)`.
- Do not rewrite canonical playbook content unless the user asks.
