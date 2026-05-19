---
description: Check whether Agent Trigger Kit source manifests and Claude plugin state are current.
---

# Agent Trigger Kit Version Command

Use this when invoking `/agent-trigger-kit-version`. The maintained workflow
lives in `skills/version-check/SKILL.md`.

## Arguments

`$ARGUMENTS`

## Delegation

Apply the `agent-trigger-kit:version-check` skill before answering or acting.

- This slash command runs in Claude Code, so default to `--surface claude`.
- Use Codex, source, or all only when `$ARGUMENTS` explicitly asks for that
  scope.
- Do not run sync, update, install, or cache repair commands unless requested.
