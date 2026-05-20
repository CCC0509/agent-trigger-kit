# Changelog

All notable user-visible changes to Agent Trigger Kit are documented here.

This project is currently in the `0.x` stage. Until a formal SemVer policy is
published, releases keep `package.json`, Codex marketplace, Codex plugin,
Claude marketplace, and Claude plugin versions aligned.

## 0.1.6 - Install Scope Guidance

- Documented the install-scope split between user-scoped Agent Trigger Kit
  installs and project-local generated ops plugins.
- Added Claude project-scope guidance for generated project plugins and noted
  that in-repo Claude marketplaces are not auto-discovered without explicit
  project install.
- Clarified that Codex has no project-scoped plugin enablement, so generated
  project plugin checks require temporary marketplace registration and cleanup.
- Added generated `MAINTENANCE.md` reminders for project plugin scope and Codex
  cleanup behavior.

## 0.1.5 - Generated Trigger Layer Cleanup

- Added schema v2 generated manifests that can track multiple project-local
  plugins in one `.agent-trigger-kit/generated.json`.
- Added `agent-trigger-kit clean` dry-run and `--apply` cleanup for orphan
  generated trigger-layer skill wrappers.
- Added `/trigger-layer-clean` so external project agents can route cleanup
  through the same plugin command surface as init and validate.

## 0.1.4 - Project Trigger Layer Maintainability

- Generated project trigger layers now preserve existing plugin versions on
  re-init and use `--initial-version` only for brand-new layers.
- Added `.agent-trigger-kit/generated.json` and
  `.agent-trigger-kit/MAINTENANCE.md` generation for managed-file tracking and
  centralized maintenance policy.
- Decoupled external project `package.json` versions from plugin version checks
  and bumps unless the package name matches the plugin name or is explicitly
  included.
- Added `--include-package` and `--no-include-package` overrides for version
  checks and plugin version bumps.

## 0.1.3 - Version Checks And Toolkit Hardening

- Added scoped version checks with `--surface codex|claude|source|all`, keeping
  source manifest consistency checks always on while limiting installed-state
  checks to the requested surface.
- Updated the `agent-trigger-kit:version-check` workflow to be read-only by
  default instead of running local sync/update commands for version questions.
- Documented the completion gate requiring aligned version bumps before commit
  and push when plugin-visible files change.
- Added `check-plugin-version --json` for automation.
- Updated the local agent refresh flow to read structured version-check output
  instead of matching human-readable stdout.
- Made `bump-plugin-version --surface` warn that partial bumps do not keep
  release versions aligned.
- Updated the project trigger-layer generator to render wrapper files from the
  checked-in templates.
- Generated skill playbook references now use the actual skill path depth
  instead of a fixed `../../../../` prefix.
- Added open-source hardening config: macOS CI coverage, pinned Claude Code CLI
  install, editor settings, lint/format scripts, badges, and SemVer policy.

## 0.1.2 - Natural Version Check Skill

- Added `agent-trigger-kit:version-check` for natural-language questions such
  as "Is Agent Trigger Kit up to date?" or "請問 kit 的版本是最新的嗎？"
- Added `/agent-trigger-kit-version` for Claude Code users who prefer a slash
  command.
- Documented the old-user bootstrap path: users on versions before 0.1.2 must
  update first before this new skill can be discovered.

## 0.1.1 - Version Confidence And Update Flow

- Added a version check utility that compares `package.json`, Codex
  marketplace, Codex plugin, Claude marketplace, and Claude plugin versions.
- Added Codex local cache reporting so users can see which plugin snapshots are
  present locally.
- Added a clearer existing-user update path for plugin users, repo checkout
  users, and projects that already generated a trigger layer.
- Updated the copy-paste setup prompt so agents inspect existing local
  playbooks, skills, commands, Cursor rules, and pointer docs before generating
  or updating wrappers.

## 0.1.0 - Initial Toolkit

- Added Codex and Claude marketplace manifests.
- Added Claude slash-command shims that delegate to skills.
- Added Cursor rule templates.
- Added project-local trigger-layer scaffolding and validation.
