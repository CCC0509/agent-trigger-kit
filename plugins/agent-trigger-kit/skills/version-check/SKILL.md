---
name: version-check
description: Use when the user asks whether Agent Trigger Kit, this kit, or agent-trigger-kit is latest, installed, stale, or needs an update; also use for Codex or Claude plugin cache version checks.
---

# Version Check

Use this when a user asks whether Agent Trigger Kit is installed, current,
latest, stale, needs an update, or whether the kit version is correct.

## Core Model

- Source version means the versions in the Agent Trigger Kit checkout.
- Installed version means the Codex or Claude plugin cache currently visible to
  the agent runtime.
- Project package versions are checked only when `package.json.name` equals the
  plugin name or ends with `/<plugin-name>`, unless `--include-package` or
  `--no-include-package` is passed.
- Version checks are read-only by default. Do not run sync, update, install, or
  cache repair commands unless the user asks to repair or update.
- For generated consumer trigger layers, `--surface source` is the static source
  alignment check for package, marketplace, and plugin manifest versions.
- Run read-only source/cache checks before any temporary Codex project
  marketplace registration or other user-level global config mutation.
- When Claude CLI unavailable appears in a Codex shell, the checkout script can
  read Claude filesystem metadata read-only. Treat that as a report, not a
  repair; next steps must be official `claude` CLI commands.
- Old installed versions cannot know about newly added skills. If this skill is
  unavailable, users must run the manual update commands from README first.

## Scope First

Choose the narrowest scope before running commands:

- If the user says Codex, Claude, source, or all/both, use that scope.
- If no scope is named, use the current runtime: Codex agent means `codex`;
  Claude Code means `claude`.
- If neither wording nor runtime makes the scope clear, ask one short question
  before inspecting installed state.

## Generated Consumer Trigger Layers

For generated consumer trigger layers, use the pinned kit source named during
scope setup and run source alignment before live discovery:

```bash
KIT_SPEC=github:CCC0509/agent-trigger-kit#<tag-or-commit>
npx --yes "$KIT_SPEC" version-check \
  --root <target-repo> \
  --surface source \
  <plugin-name>
```

`version-check --surface source` checks source alignment across the package,
marketplace, and plugin manifest versions. `live-check` checks installed-state drift
from the consumer-owned matrix in `.agent-trigger-kit/live-surfaces.yaml`;
it is read-only by default and reports manual next actions instead of updating
Codex or Claude state.

## Checklist

1. If the current working directory is an Agent Trigger Kit checkout, run the
   pure read-only version check:

   ```bash
   npm run ops:plugin-version-check -- --surface <codex|claude|source|all> agent-trigger-kit
   ```

   This always checks source manifest consistency. `codex` adds Codex cache
   state, `claude` adds Claude installed state, `source` checks manifests only,
   and `all` checks both installed surfaces.

2. If not in a checkout, inspect only the requested installed surface when
   possible:

   ```bash
   ls ~/.codex/plugins/cache/agent-trigger-kit/agent-trigger-kit
   codex debug prompt-input "test"

   claude plugin list --json
   ```

   Explain that full source version checking requires an Agent Trigger Kit
   checkout because the source manifests and scripts live there.

3. If Codex installed state is stale, tell the user the update command for the
   scoped surface:

   ```bash
   codex plugin marketplace upgrade agent-trigger-kit
   codex debug prompt-input "test"
   ```

   If Claude metadata is stale but the `claude` CLI is unavailable in this shell,
   report the metadata state and give the operator commands to run where Claude
   Code exposes the CLI:

   ```bash
   claude plugin marketplace update agent-trigger-kit
   claude plugin update agent-trigger-kit@agent-trigger-kit --scope user
   ```

4. Tell Claude Code users to restart Claude Code after install or update.

5. If the user explicitly asks to repair a local Codex cache from a checkout,
   run or suggest the narrower cache sync command:

   ```bash
   npm run ops:plugin-cache-sync -- agent-trigger-kit
   ```

## Reporting

- Report source versions separately from installed/cache versions.
- If installed state is stale, say exactly which surface is stale.
- If a live Codex discovery step mutates global config, report whether the
  temporary generated project marketplace was removed and whether global config cleanup was verified.
- If a command is unavailable in the current shell, name the command the user
  should run in the right environment.
