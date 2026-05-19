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
- Version checks are read-only by default. Do not run sync, update, install, or
  cache repair commands unless the user asks to repair or update.
- Old installed versions cannot know about newly added skills. If this skill is
  unavailable, users must run the manual update commands from README first.

## Scope First

Choose the narrowest scope before running commands:

- If the user says Codex, Claude, source, or all/both, use that scope.
- If no scope is named, use the current runtime: Codex agent means `codex`;
  Claude Code means `claude`.
- If neither wording nor runtime makes the scope clear, ask one short question
  before inspecting installed state.

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

3. If Codex or Claude installed state is stale, tell the user the update command
   for the scoped surface:

   ```bash
   codex plugin marketplace upgrade agent-trigger-kit
   codex debug prompt-input "test"

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
- If a command is unavailable in the current shell, name the command the user
  should run in the right environment.
