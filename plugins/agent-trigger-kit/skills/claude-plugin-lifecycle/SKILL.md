---
name: claude-plugin-lifecycle
description: Use when Claude Code plugins are installed but skills or slash commands do not appear, plugin cache is stale, version bumps are needed, or .orphaned_at appears.
---

# Claude Plugin Lifecycle

Claude Code installs plugins into a cache snapshot. Source repo changes are not live until the plugin manager updates or reinstalls the plugin, and Claude Code must restart to apply changes.

## Diagnose

1. Confirm install state:

   ```bash
   claude plugin list --json
   ```

2. Confirm the marketplace and plugin manifests:

   ```bash
   claude plugin validate <repo-root>
   claude plugin validate <repo-root>/plugins/<plugin-name>
   ```

3. Inspect the cache path from `plugin list --json`.
   - `skills/` present but no slash menu: expected unless `commands/` exists and is declared.
   - source has `commands/` but cache does not: stale snapshot or version issue.
   - `.orphaned_at` exists: install/cache state needs cleanup or reinstall.

## Fix Missing Slash Commands

1. Add command shims under `plugins/<plugin-name>/commands/*.md`.
2. Add `"commands": ["./commands/"]` to `plugins/<plugin-name>/.claude-plugin/plugin.json`.
3. Bump the Claude plugin version in both:
   - `.claude-plugin/marketplace.json`
   - `plugins/<plugin-name>/.claude-plugin/plugin.json`
4. Run:

   ```bash
   claude plugin marketplace update <marketplace-name>
   claude plugin update <plugin-name>@<marketplace-name> --scope user
   ```

5. If update still reports already latest while cache is stale:

   ```bash
   claude plugin uninstall <plugin-name>@<marketplace-name> --scope user
   claude plugin install <plugin-name>@<marketplace-name> --scope user
   ```

6. Restart Claude Code.

## Red Flags

- `enabled: true` but slash commands are absent.
- Cache version differs from source manifest version.
- Cache lacks `commands/` after source added it.
- `.orphaned_at` exists under the plugin cache.
- The session was not restarted after plugin install or update.
