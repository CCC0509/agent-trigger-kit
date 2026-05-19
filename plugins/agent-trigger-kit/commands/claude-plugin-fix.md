---
description: Diagnose and fix Claude Code plugin cache, version, commands, and orphaned install issues.
---

# Claude Plugin Fix Command

Use this when invoking `/claude-plugin-fix`. The maintained workflow lives in `skills/claude-plugin-lifecycle/SKILL.md`.

## Arguments

`$ARGUMENTS`

## Delegation

Apply the `agent-trigger-kit:claude-plugin-lifecycle` skill before answering or acting.

- Check manifest validation, installed version, cache contents, and `.orphaned_at`.
- Bump Claude plugin version when source changes require a fresh cache snapshot.
- Restart Claude Code after install or update.
