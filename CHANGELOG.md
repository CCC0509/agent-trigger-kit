# Changelog

All notable user-visible changes to Agent Trigger Kit are documented here.

This project is currently in the `0.x` stage. Until a formal SemVer policy is
published, releases keep `package.json`, Codex marketplace, Codex plugin,
Claude marketplace, and Claude plugin versions aligned.

## Unreleased

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
