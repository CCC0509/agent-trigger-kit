---
name: cross-agent-trigger-layer
description: Use when creating or maintaining project-local trigger layers shared by Codex, Claude Code, Cursor, AGENTS.md, CLAUDE.md, and GEMINI.md.
---

# Cross-Agent Trigger Layer

Use this skill when a project needs the same operating rules to be discoverable by multiple agents.

## Core Model

- The project playbook is canonical.
- Codex and Claude skills are trigger wrappers.
- Claude commands are slash-menu shims that delegate to skills.
- Cursor rules are path-trigger wrappers.
- AGENTS.md, CLAUDE.md, and GEMINI.md are short pointers.
- For existing Claude Code skills, prefer `agent-trigger-kit import-claude-skills`;
  it moves skill bodies into the canonical playbook, keeps descriptions on
  generated wrappers, and deletes source skills after a successful import unless
  `--keep-source` is passed.

Do not copy long SOP bodies into trigger layers.

Install scope is part of the trigger-layer contract. Agent Trigger Kit itself is
a user-scope toolkit. Generated project ops plugins should stay local to the
consuming project: Claude Code uses project scope when explicit plugin loading
is needed, Cursor uses repo-local rules, and Codex currently has no project
scope, so any Codex project-plugin registration is temporary verification plus
cleanup.

## Build Order

1. Identify the canonical playbook path and the task names.
2. Create project-local plugin manifests for Codex and Claude.
3. Create `.agent-trigger-kit/MAINTENANCE.md` and
   `.agent-trigger-kit/generated.json`; keep `generated.json` committed.
4. Create one thin skill per task.
5. For Claude Code discoverability, create one command shim per task and declare `commands` in `.claude-plugin/plugin.json`.
6. For Cursor, create `.cursor/rules/*.mdc` only when task-specific globs are known.
7. Add or update a validator that checks all trigger surfaces.
8. Document install scope, verification, cleanup, and fallback behavior in pointer docs.
9. When tasks are removed, run a clean dry-run for the project and plugin before
   applying orphan cleanup.

## Required Checks

- `node scripts/validate-trigger-layer.mjs --root <project>`
- `claude plugin validate <project>`
- `claude plugin validate <project>/plugins/<plugin-name>`
- For generated Claude project plugins, confirm `claude plugin list --json`
  reports `"scope": "project"` and the expected `projectPath` after explicit
  install.
- A fresh Codex or `codex debug prompt-input "test"` check when Codex plugin behavior changes.
- If Codex project-plugin discovery was tested, remove the temporary marketplace
  and confirm the global config no longer contains the project plugin.
- A fresh Claude Code session after installing or updating Claude commands.

## Common Mistakes

- Treating Claude `skills/` as slash commands.
- Forgetting to bump Claude plugin version after adding `commands/`.
- Letting Cursor globs become comma-separated strings when the repo uses YAML lists.
- Updating playbooks without checking wrappers, commands, Cursor rules, and pointer docs.
- Assuming removed tasks are deleted by `init --force`; use clean dry-run before
  applying generated-wrapper cleanup.
- Confusing the user-scope Agent Trigger Kit install with generated project ops
  plugins, which should stay project-local.
- Assuming Codex has project-scoped plugin enablement; it does not, so project
  plugin registration must be temporary and cleaned up.
