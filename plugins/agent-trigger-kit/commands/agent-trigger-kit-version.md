---
description: Check whether Agent Trigger Kit source manifests and local plugin caches are current.
---

# Agent Trigger Kit Version Command

Use this when invoking `/agent-trigger-kit-version`. The maintained workflow
lives in `skills/version-check/SKILL.md`.

## Arguments

`$ARGUMENTS`

## Delegation

Apply the `agent-trigger-kit:version-check` skill before answering or acting.
- Check source manifest versions when an Agent Trigger Kit checkout is
  available.
- Check Codex and Claude installed/cache state when possible.
- Report stale cache/update steps separately for Codex and Claude.
