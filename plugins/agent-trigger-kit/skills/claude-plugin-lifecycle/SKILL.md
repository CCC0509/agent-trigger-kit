---
name: claude-plugin-lifecycle
description: Use when Claude Code plugins are installed but skills or slash commands do not appear, plugin cache is stale, version bumps are needed, or .orphaned_at appears.
---

# Claude Plugin Lifecycle

Claude Code installs plugins into a cache snapshot. Source repo changes are not live until the plugin manager updates or reinstalls the plugin, and Claude Code must restart to apply changes.

## Install Scope

Pick scope from the plugin role before running install or update commands.
Agent Trigger Kit itself is a cross-project tool and belongs at user scope.
Generated `<project>-ops` plugins belong to the consuming project; when explicit
Claude loading is needed, add the marketplace and install the plugin with
project scope.

Claude Code does not auto-discover a generated in-repo
`.claude-plugin/marketplace.json` just because it exists. If it is unclear
whether the user is installing the kit itself or a generated project plugin, ask
one short scope question instead of defaulting blindly.

## Provenance Boundary

Agent Trigger Kit itself is a Git-sourced marketplace in Claude Code. Do not copy
a local working tree into `~/.claude/plugins/marketplaces/**` or
`~/.claude/plugins/cache/**` as a default repair. That makes the cache files
disagree with the marketplace clone's Git `HEAD`.

If `claude` is unavailable in the current shell, inspect filesystem metadata
read-only and report official commands for a shell where `claude` is available.
Dirty marketplace clones should be reported by path and dirty file list before
running update commands.

## Diagnose

1. Confirm install state with the preferred install-state evidence:

   ```bash
   claude plugin list --json
   ```

   For generated project plugins, confirm `"scope": "project"` and the expected
   `projectPath`.

2. Confirm the marketplace and plugin manifests when the validate command is
   reliable in the current environment:

   ```bash
   claude plugin validate <repo-root>
   claude plugin validate <repo-root>/plugins/<plugin-name>
   ```

   If `claude plugin validate <path>` hangs, treat the result as inconclusive
   and use a 20 second timeout wrapper only to keep the session from blocking.
   Do not make the hanging validate command the only discovery signal.

3. Inspect the cache path from `plugin list --json`.
   - `skills/` present but no slash menu: expected unless `commands/` exists and is declared.
   - source has `commands/` but cache does not: stale snapshot or version issue.
   - `.orphaned_at` exists: install/cache state needs cleanup or reinstall.

4. Restart Claude Code after install or update before deciding that skills or
   slash commands are missing.

## Fix Missing Slash Commands

1. Add command shims under `plugins/<plugin-name>/commands/*.md`.
2. Add `"commands": ["./commands/"]` to `plugins/<plugin-name>/.claude-plugin/plugin.json`.
3. Bump the Claude plugin version in both:
   - `.claude-plugin/marketplace.json`
   - `plugins/<plugin-name>/.claude-plugin/plugin.json`
4. Run:

   ```bash
   claude plugin marketplace update <marketplace-name>
   claude plugin update <plugin-name>@<marketplace-name> --scope <user|project>
   ```

5. If update still reports already latest while cache is stale:

   ```bash
   claude plugin uninstall <plugin-name>@<marketplace-name> --scope <user|project>
   claude plugin install <plugin-name>@<marketplace-name> --scope <user|project>
   ```

6. Restart Claude Code.

## Red Flags

- `enabled: true` but slash commands are absent.
- Cache version differs from source manifest version.
- Cache lacks `commands/` after source added it.
- `.orphaned_at` exists under the plugin cache.
- The session was not restarted after plugin install or update.
