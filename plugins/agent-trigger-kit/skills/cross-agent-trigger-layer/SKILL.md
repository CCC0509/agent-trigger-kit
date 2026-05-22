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
- Generated project skills carry playbook-first guidance: for covered tasks,
  the project playbook is the source of truth and generic helper guidance should
  align with it rather than override it.
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

## Scope First

Before changing a generated consumer trigger layer, name the target repo path,
current working directory, plugin name, canonical playbook path, generated
manifest path, agent surfaces in scope, and Agent Trigger Kit source or installed version
used for generation.

If those values cannot be named, stop before writing files or running
install/update commands. This is operator discipline; the validator cannot infer
whether the agent is working in the intended repo.

Use the same pinned Agent Trigger Kit source for generation and validation. For
`npx`, pin the GitHub package spec to a tag or commit SHA. Do not use an
unqualified `github:CCC0509/agent-trigger-kit` package spec in CI.

## Build Order

1. Identify the canonical playbook path and the task names.
2. Create project-local plugin manifests for Codex and Claude.
3. Create `.agent-trigger-kit/MAINTENANCE.md` and
   `.agent-trigger-kit/generated.json`; keep `generated.json` committed.
4. Create one thin skill per task.
5. For Claude Code discoverability, create one command shim per task and declare `commands` in `.claude-plugin/plugin.json`.
6. Use task-specific skill descriptions when task names alone are too sparse for discovery.
7. For Cursor, create `.cursor/rules/*.mdc` only when task-specific globs are known.
8. Add or update a validator that checks all trigger surfaces.
9. Document install scope, verification, cleanup, and fallback behavior in pointer docs.
10. When tasks are removed, run a clean dry-run for the project and plugin before
    applying orphan cleanup.

## Static Gate

The static gate is CI-safe and does not depend on user-level agent state. For a
consumer repo, prefer the packaged CLI entrypoint because it runs the same
canonical validator as `scripts/validate-trigger-layer.mjs`:

```bash
KIT_SPEC=github:CCC0509/agent-trigger-kit#<tag-or-commit>
npx --yes "$KIT_SPEC" validate --root <target-repo>
npx --yes "$KIT_SPEC" version-check \
  --root <target-repo> \
  --surface source \
  <plugin-name>
npx --yes "$KIT_SPEC" validate \
  --root <target-repo> \
  --require-version-bump \
  --base main
```

Use `version-check --surface source` when the workflow needs full source version
alignment but the branch does not have a plugin-visible diff that triggers
`--require-version-bump`.

Plugin-visible changes include generated skills, generated commands, plugin
manifests, and marketplace entries for the plugin. Wrapper typo fixes are still
plugin-visible changes and need an aligned version bump.

## Manual Live Discovery

Live discovery is a manual release checklist, not a CI gate. Run it only after
the static gate passes, required version bumps are applied, relevant plugins are
installed or updated, and Claude Code has been restarted after install/update.

Codex:

```bash
codex debug prompt-input "test"
```

Confirm the expected `<plugin-name>:<skill-name>` entries. If a generated
project plugin was temporarily added to Codex global config for discovery,
remove it afterwards and confirm `~/.codex/config.toml` no longer contains the
project plugin.

Claude Code:

```bash
claude plugin list --json
```

For generated project plugins, confirm `"scope": "project"` and the expected
`projectPath`. Treat `claude plugin validate <path>` hangs as inconclusive; use
a 20 second timeout wrapper when needed to keep the session from blocking. Do
not make a hanging validate command the only discovery signal.

Cursor:

Cursor support is static in this toolkit. Verify `.cursor/rules/*.mdc`
frontmatter, globs, and canonical references. Do not describe Cursor as having a
headless runtime discovery gate unless a real probe is added later.

Gemini:

Gemini is out of scope unless the kit adds Gemini templates and validator rules.
Pointer link checks for existing `GEMINI.md` files are not generated Gemini
trigger-layer support.

## Failure Branches

If static validation fails, block the PR and repair the generated layer or
canonical refs before live discovery.

If a consuming project has a stale local validator, replace the workflow with
the current kit validator or regenerate the trigger layer. Do not patch the
stale validator by hand unless the project intentionally owns a fork.

If Codex discovery fails, check whether the marketplace root was added instead
of the plugin subdirectory, whether the installed cache is stale, and whether
global config cleanup left the plugin disabled or absent.

If Claude discovery fails, check install scope, `projectPath`, cache version,
declared `commands`, stale snapshots, `.orphaned_at`, and whether Claude Code was
restarted after update.

If a live discovery step mutates user-level config and the session is
interrupted, cleanup is required before reporting completion. The final report
must say whether cleanup was verified.

## Common Mistakes

- Treating Claude `skills/` as slash commands.
- Forgetting to bump Claude plugin version after adding `commands/`.
- Letting Cursor globs become comma-separated strings when the repo uses YAML lists.
- Updating playbooks without checking wrappers, commands, Cursor rules, and pointer docs.
- Assuming removed tasks are deleted by `init --force`; use clean dry-run before
  applying generated-wrapper cleanup.
- Confusing the user-scope Agent Trigger Kit install with generated project ops
  plugins, which should stay project-local.
- Validating consumer trigger layers with a floating `github:CCC0509/agent-trigger-kit`
  package spec instead of the pinned kit source named during scope setup.
- Assuming Codex has project-scoped plugin enablement; it does not, so project
  plugin registration must be temporary and cleaned up.
- Treating live discovery as a CI gate; Codex and Claude can be probed manually,
  while Cursor is static-only in this toolkit.
- Forgetting that Claude Code must restart after plugin install or update before
  skill and slash-command discovery results are meaningful.
