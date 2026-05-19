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
- Old installed versions cannot know about newly added skills. If this skill is
  unavailable, users must run the manual update commands from README first.

## Checklist

1. If the current working directory is an Agent Trigger Kit checkout, run:

   ```bash
   npm run ops:local-agent-sync -- agent-trigger-kit
   ```

   Use `--no-codex-debug` when prompt-input output would be too noisy for the
   current task.

2. If not in a checkout, inspect installed state when possible:

   ```bash
   claude plugin list --json
   codex debug prompt-input "test"
   ```

   Explain that full source version checking requires an Agent Trigger Kit
   checkout because the source manifests and scripts live there.

3. If Codex or Claude cache is stale, tell the user to update:

   ```bash
   codex plugin marketplace upgrade agent-trigger-kit
   codex debug prompt-input "test"

   claude plugin marketplace update agent-trigger-kit
   claude plugin update agent-trigger-kit@agent-trigger-kit --scope user
   ```

4. Tell Claude Code users to restart Claude Code after install or update.

5. If only a local Codex cache repair is needed, run or suggest the narrower
   cache sync command:

   ```bash
   npm run ops:plugin-cache-sync -- agent-trigger-kit
   ```

## Reporting

- Report source versions separately from installed/cache versions.
- If installed state is stale, say exactly which surface is stale.
- If a command is unavailable in the current shell, name the command the user
  should run in the right environment.
