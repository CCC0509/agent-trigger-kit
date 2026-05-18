---
name: cursor-rule-sync
description: Use when creating or updating Cursor .mdc rules that mirror project playbooks, agent skills, or plugin trigger wrappers.
---

# Cursor Rule Sync

Cursor rules are trigger wrappers. Keep them short and route to the canonical project playbook.

## Rule Shape

Use YAML frontmatter. Preserve the repo's existing `globs` style. If the repo uses YAML lists, append to the list instead of converting it to a comma-separated string.

```md
---
description: Use for docs, playbooks, todo, done-log, review-log, and docs-only closeout.
globs:
  - README.md
  - docs/**
---

Read the canonical playbook before acting:

- `docs/agent-playbooks/project-ops.md`

This rule is a trigger wrapper only. Do not duplicate the long SOP body here.
```

## Drift Gate

When playbooks, plugin skills, Claude commands, Cursor rules, or pointer docs change, run the project trigger-layer validator and decide whether other layers need synchronized wording.

## Avoid

- Broad `**/*` globs unless the project explicitly wants an always-on rule.
- Long SOP bodies in `.mdc` files.
- Divergent instructions between Cursor and AGENTS.md / CLAUDE.md.
