---
description: Create a project-local trigger layer for Codex, Claude Code, and Cursor.
---

# Trigger Layer Init Command

Use this when invoking `/trigger-layer-init`. The maintained workflow lives in `skills/cross-agent-trigger-layer/SKILL.md`.

## Arguments

`$ARGUMENTS`

## Delegation

Apply the `agent-trigger-kit:cross-agent-trigger-layer` skill before answering or acting.

- Identify the canonical playbook, plugin name, and task names.
- Prefer the bundled `scripts/init-project-trigger-layer.mjs` when scaffolding files.
- Keep generated trigger layers thin and playbook-centric.
