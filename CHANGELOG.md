# Changelog

All notable user-visible changes to Agent Trigger Kit are documented here.

This project is currently in the `0.x` stage. Until a formal SemVer policy is
published, releases keep `package.json`, Codex marketplace, Codex plugin,
Claude marketplace, and Claude plugin versions aligned.

## 0.2.4

- Workflow helpers: added `spec-graduate`, `audit-cleanup`, and `ship-gate` for
  mechanical spec graduation, read-only post-merge cleanup audit, and local
  pre-PR composite checks.

## 0.2.2

- Session check: treats readable read-only outcome stores as healthy, reports
  outcome-store writability as diagnostic JSON and human output, and keeps the
  existing exit-code table unchanged.
- Scratch hygiene: replaces fixed `/private/tmp/agent-trigger-kit-*` examples
  with disposable temp paths and cleans test-created temp directories after
  each run.

## 0.2.1

- Outcome report gates: JSON-only `outcome report --gates --json` summary for
  Graphify, ECC, and Safety evidence gates with explicit disabled schema-gap
  states and ECC 3-tuple repetition candidates.
- Session check: top-level `session-check` command for read-only session start
  and closeout health checks, plus AGENTS / CLAUDE guidance and a discoverable
  `agent-trigger-kit:session-check` skill.

## 0.2.0

### Added

- Outcome recorder: append-only JSONL ledger with auto-emit hooks for
  validate / live-check / premerge-version-check / scratch-namespace-check and
  manual `outcome record` / `mark` / `report` CLI verbs.
- Outcome schema v0.1: closed-enum record format with cross-validation rules,
  deterministic mark-override aggregation, and `validateRecord()` public API.
- Historical backfill: one-shot `ops:backfill-outcomes` script with
  deterministic UUID v7 idempotency and `.local.yaml` private override.
- Outcome report: hypothesis-direct propagation reliability output (success
  rate, per-surface, per-failure-category) in human and JSON forms with
  `--since` / `--surface` / `--verb` filters.
- Outcome mark UX: `outcome events` discovery surface with short-id resolution,
  `outcome mark --last`, mark-of-mark rejection, and TTY prompt flow with
  non-TTY safety.

### Schema

- This release introduces canonical event schema v0.1; readers reject unknown
  fields and future schema versions.

### Known follow-ups

- `outcome report --until`, cross-window comparison
- `--failure-category` filter
- Historical baseline durability vs `ts`-based retention (decision deadline:
  before the first 60-day analysis window closes)
- `outcome events --has-marks` filter and human `MARKED` column
- Bulk mark / triage walk

## 0.1.15

- Added the outcome recorder MVP with manual record/mark/report commands and
  auto-emission from validate, live-check, premerge, and scratch namespace
  checks.

## 0.1.14

- Added matrix-driven live trigger surface checks for consumer repositories,
  including read-only Codex/Claude drift probes, generated matrix docs, and
  static matrix validation.

## 0.1.13

- Added a source-repo pre-merge version reconciliation check for Agent Trigger
  Kit branches, covering base reconciliation, changelog head alignment,
  source-visible version bumps, and optional local hook installation.

## 0.1.12

- Added a pull request `Scratch Namespace Advisory` check that emits warning annotations
  for tracked `docs/superpowers/` files without blocking ordinary review.
- Documented the consumer trigger-layer lifecycle with scope-first setup,
  pinned static validation, and manual live-discovery boundaries.
- Made `agent-trigger-kit:cross-agent-trigger-layer` the canonical home for the
  generated project plugin live-discovery checklist.
- Clarified Claude Code restart and `claude plugin validate` timeout guidance
  for generated project plugin troubleshooting.

## 0.1.11

- Recorded an internal trigger-layer validate command formatting release with no
  user-visible behavior changes.

## 0.1.10

- Added opt-in document header checks to trigger-layer validation, configured
  from `.agent-trigger-kit/generated.json`.
- Added `init --with-superpowers-gate` to scaffold the Superpowers plan/spec
  status-header policy only when explicitly requested.

## 0.1.9

- Added provenance-aware version reporting for Claude Code when the `claude` CLI
  is unavailable in the current shell.
- Kept Claude Code filesystem fallback read-only and limited local cache copying
  to local Codex marketplace sources.
- Preserved trigger-layer validation and Codex prompt-input verification in the
  local agent sync workflow.

## 0.1.8 - Playbook-First Guidance

- Added playbook-first guidance to generated project trigger-layer skill
  descriptions and checklists so project playbooks stay visible when generic
  helper skills also match a task.
- Added `init --task-descriptions` for richer task-specific generated skill
  descriptions.
- Added flag-gated validation for generated skill guidance drift.

## 0.1.7 - Claude Skill Importer

- Added `agent-trigger-kit import-claude-skills` for migrating existing Claude
  Code skills into project-local cross-agent trigger layers while preserving
  descriptions.

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
