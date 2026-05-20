# Provenance-Aware Plugin Sync Design

**Goal:** Make Agent Trigger Kit local sync and version reporting choose honest, provenance-aware paths for Codex and Claude Code, so stale or unavailable plugin tooling produces actionable reports without mutating Claude Code state outside the official Claude CLI.

**Status:** Design spec. No code has been changed by this spec.

## Problem

The current local agent refresh path treats Codex and Claude Code as if they were symmetric surfaces. They are not.

Codex uses a local marketplace entry for Agent Trigger Kit:

```json
{
  "source": {
    "source": "local",
    "path": "./plugins/agent-trigger-kit"
  }
}
```

Copying the local checkout into Codex's cache is honest for that surface because the marketplace source is the local checkout.

Claude Code, for Agent Trigger Kit itself, uses a Git marketplace source:

```json
{
  "source": {
    "source": "git",
    "url": "https://github.com/CCC0509/agent-trigger-kit.git"
  }
}
```

Copying an arbitrary local working tree into Claude Code's Git-sourced marketplace clone or plugin cache breaks provenance. The files no longer match the clone's Git `HEAD`, and `installed_plugins.json` cannot honestly represent the cache with a real source commit. A fallback that silently copies local files into Claude's cache would turn an emergency repair into a supported workflow.

The current behavior also leaves too much ambiguity when `claude` is unavailable in the current shell. `check-plugin-version.mjs` reports `cli-unavailable` and stops there, even though `~/.claude/plugins/installed_plugins.json` and the cache directories can still provide useful read-only installed-state evidence.

## Non-Negotiable Invariant

Agent Trigger Kit program code must not mutate Claude Code plugin state except by invoking the official `claude` CLI.

For this spec, Claude Code state includes:

- `~/.claude/plugins/installed_plugins.json`
- `~/.claude/plugins/known_marketplaces.json`
- `~/.claude/plugins/marketplaces/**`
- `~/.claude/plugins/cache/**`

All Agent Trigger Kit filesystem access to Claude Code paths is read-only. If the official `claude` CLI is unavailable, Agent Trigger Kit reports the state and prints the commands to run in an environment where `claude` is available.

## Out Of Scope

Working-tree-to-Claude-cache copy tools are intentionally excluded.

This includes any script that copies `plugins/<plugin-name>` or the local repo checkout into `~/.claude/plugins/cache/**` or `~/.claude/plugins/marketplaces/**`. That class of tool is excluded because it makes Git-sourced Claude marketplace provenance false. Agent Trigger Kit's Claude marketplace for the kit itself is Git-sourced, so local file copy is not a valid default fallback.

If repeated real-world development needs prove that a dev-only break-glass flow is needed, it must get a separate spec. That future spec must name the provenance risk explicitly, define what commit identity is recorded, handle active `.in_use` sessions, and use an opt-in command name and flags that make the risk hard to miss.

## Design Principles

- Codex local cache sync is allowed only when the Codex marketplace source is local.
- Claude Code sync uses the official `claude` CLI or becomes report-only.
- Reporting must work even when state is dirty, stale, orphaned, or partially missing.
- Dirty marketplace state can block write actions, not reporting. Cache health
  markers are warnings that shape recommendations.
- Scope changes are conservative: default to user scope for Agent Trigger Kit itself and never update unrelated project/local installs unless explicitly requested.
- JSON output is a public contract for scripts that consume `check-plugin-version.mjs`.
- Human-readable output must always include next-step commands when a surface cannot be updated by the current process.

## Probe Module

Create `scripts/lib/plugin-state-probe.mjs` as a shared read-only probe used by both `check-plugin-version.mjs` and `update-local-agent-triggers.mjs`.

The probe performs only fast checks:

- Resolve `codex` and `claude` executables with PATH lookup. Codex CLI
  availability is used only for prompt-input verification; Codex cache sync is
  filesystem-based when the marketplace source is local.
- Read source marketplace and plugin manifests from the current repo.
- Read Codex cache directory names from the configured `--codex-home`.
- Read Claude settings and plugin metadata files when present.
- Stat Claude install paths and cache directories.
- Inspect Claude marketplace clone state without network access.

The probe must not run `claude plugin list --json`, `claude plugin update`, `git pull`, or any other slow or mutating command. Those belong to explicit update paths after the probe has selected a policy.

### Claude CLI Availability

The probe distinguishes these cases:

- `available`: `claude` is in PATH for the current shell.
- `path-missing-with-home`: `claude` is not in PATH, but `~/.claude` exists.
- `not-initialized`: `claude` is not in PATH and `~/.claude` does not exist.

`path-missing-with-home` must not be reported as "Claude is not installed." It means the current agent shell cannot invoke the Claude CLI, while Claude Code state exists on disk.

## Claude Filesystem Fallback Reporting

When `claude` is unavailable, `check-plugin-version.mjs --surface claude|all --json` reads Claude metadata and emits a read-only fallback status.

It reads:

- `~/.claude/plugins/installed_plugins.json`
- `~/.claude/plugins/known_marketplaces.json`
- `~/.claude/settings.json`
- install paths referenced by installed plugin entries
- marketplace clone paths referenced by known marketplaces

`settings.json` is used only to report whether `enabledPlugins` currently marks
the plugin id as enabled, disabled, or absent. It must not be rewritten.

The fallback cross-checks each installed entry:

- `scope`
- `projectPath` when present
- `version`
- `installPath`
- `installPathExists`
- `installPathHasFiles`
- `gitCommitSha` when present
- `hasExpectedVersion`
- `enabled` from `settings.json`, when known

An installed entry is considered a usable expected install only when it has the
expected version and its `installPath` exists and contains files. If all entries
are missing, stale, missing their install path, or pointing at an empty install
path, `versionMismatch` is `true`. With `--strict-installed`, that state exits
nonzero.

It does not compare the local checkout to Claude cache contents. For a Git-sourced Claude marketplace, source checkout and installed cache may have different provenance. A cache file diff would be misleading and is not part of this design.

## Dirty And Suspicious State Detection

The probe reports suspicious Claude marketplace or cache state without treating every signal as the same severity.

### Marketplace Clone Signals

For a Git marketplace clone:

- `headSha`: current marketplace clone `HEAD`, if available.
- `dirtyFiles`: porcelain status entries, if available.
- `headDiffersFromInstalledSha`: informational signal that the marketplace clone has moved since a recorded install.
- `dirtyClone`: warning signal that files have been modified outside a clean Git state.

`headDiffersFromInstalledSha` and `dirtyClone` are separate. A moved `HEAD` can
be normal after a marketplace update. Dirty files mean the clone no longer
faithfully represents a Git commit and should block write actions until
repaired.

If `git` is unavailable, the marketplace path is missing, or the marketplace is
not a Git repo, the probe degrades gracefully: it records the unavailable signal
as a warning and continues reporting the rest of the filesystem metadata.

### Cache Signals

For each install path:

- `.orphaned_at` present: warning.
- `.in_use/*` present: warning.
- `installPathExists` false: warning.
- `installPathHasFiles` false: warning.

Active `.in_use` markers and `.orphaned_at` markers are never Claude blockers in
this spec because Agent Trigger Kit does not replace or delete Claude cache
paths directly. They should appear in reports and influence next-step
recommendations. For example, `.orphaned_at` should prefer an official
`claude plugin uninstall` plus `claude plugin install` recommendation over a
plain update recommendation.

## JSON Contract

`check-plugin-version.mjs --json` keeps its existing top-level fields and adds
structured details. The old coarse `cli-unavailable` status is intentionally
replaced by more precise unavailable states, so consumers that compare exact
status strings must handle the new values. Existing in-repo consumers that read
only `codexCache.hasExpected`, `versionMismatch`, or non-Claude fields remain
compatible.

Both `check-plugin-version.mjs` and `update-local-agent-triggers.mjs` accept an
optional `--claude-home <path>` argument, matching the existing `--codex-home`
pattern. Production defaults to `~/.claude`; tests must pass temporary Claude
homes explicitly.

Required top-level shape:

```json
{
  "pluginName": "agent-trigger-kit",
  "expectedVersion": "0.1.8",
  "sourceVersions": [],
  "codexCache": {},
  "claude": {},
  "versionMismatch": false,
  "actions": []
}
```

Consumers should treat `claude.status` as an enum and must not assume all CLI
unavailable cases share one status string.

### Claude Status Values

`claude.status` may be:

- `skipped`: Claude surface was not requested.
- `present`: official CLI reported the expected installed version.
- `stale`: official CLI reported an installed version different from source expected version.
- `missing`: official CLI or filesystem fallback found no installed entry.
- `cli-unavailable-metadata-present`: CLI unavailable, metadata file exists and contains plugin entries.
- `cli-unavailable-metadata-missing`: CLI unavailable and the metadata file is missing.
- `not-initialized`: CLI unavailable and no Claude Code home was found.
- `command-failed`: official CLI ran and failed.
- `parse-error`: official CLI output or metadata JSON could not be parsed.

If `installed_plugins.json` exists but contains no entry for the requested
plugin id, `claude.status` is `missing`. CLI availability remains visible in
`claude.cli.status`; do not encode "CLI unavailable" into the top-level status
when the plugin itself is missing.

For fallback states, `claude.entries` contains one object per installed entry.

```json
{
  "status": "cli-unavailable-metadata-present",
  "pluginId": "agent-trigger-kit@agent-trigger-kit",
  "cli": {
    "status": "path-missing-with-home"
  },
  "entries": [
    {
      "scope": "user",
      "projectPath": null,
      "version": "0.1.8",
      "hasExpectedVersion": true,
      "installPath": "/Users/example/.claude/plugins/cache/agent-trigger-kit/agent-trigger-kit/0.1.8",
      "installPathExists": true,
      "installPathHasFiles": true,
      "enabled": true,
      "gitCommitSha": "071e8db6d5f00d3c78008000134295373e1305bc",
      "warnings": []
    }
  ],
  "marketplace": {
    "name": "agent-trigger-kit",
    "source": {
      "source": "git",
      "url": "https://github.com/CCC0509/agent-trigger-kit.git"
    },
    "installLocation": "/Users/example/.claude/plugins/marketplaces/agent-trigger-kit",
    "headSha": "868c3cb3a0bf643a2730ddac9cef1ce1f64a8da3",
    "dirtyFiles": ["M .claude-plugin/marketplace.json"],
    "warnings": ["dirty-clone"]
  }
}
```

### Actions

The top-level `actions` array is the canonical next-step contract. It contains
commands or manual steps that can be shown in human output and consumed by
automation. Human-readable copyable commands are derived from `actions`; the
Claude object must not maintain a second independent recommended-command list.

Each action includes:

- `surface`: `codex` or `claude`
- `kind`: `command` or `manual`
- `command`: array form for commands, when applicable
- `reason`: short stable reason string
- `requiresCli`: optional CLI name

Example:

```json
{
  "surface": "claude",
  "kind": "command",
  "command": [
    "claude",
    "plugin",
    "update",
    "agent-trigger-kit@agent-trigger-kit",
    "--scope",
    "user"
  ],
  "reason": "claude-cli-unavailable-current-shell",
  "requiresCli": "claude"
}
```

## Exit Codes

Default version checks remain non-failing for stale or unusable installed state
unless `--strict-installed` is passed.

- Source manifest mismatch: exit `1`.
- Invalid arguments: exit `2`.
- Requested surface unavailable but report produced: exit `0`.
- Installed state stale or unusable and `--strict-installed` absent: exit `0`.
- Installed state stale or unusable and `--strict-installed` present: exit `1`.
- Parse error for requested installed metadata and `--strict-installed` absent:
  exit `0` with `status: "parse-error"` so the report remains visible.
- Parse error for requested installed metadata and `--strict-installed` present:
  exit `1`.

This keeps reporting usable in dirty states while preserving a strict mode for CI or release gates.

## Local Agent Sync Policy

`update-local-agent-triggers.mjs` uses the shared probe to choose actions.

Existing non-sync checks remain part of the command:

- Run `validate-trigger-layer.mjs --root <root>` before local sync decisions.
- Preserve Codex prompt-input verification after Codex sync unless
  `--no-codex-debug` is passed or the Codex CLI is unavailable.
- Use the probe's Codex CLI availability only for that prompt-input
  verification step; it does not determine whether filesystem cache sync is
  allowed.

### Codex

Codex local cache sync remains supported when:

- the Codex marketplace entry exists,
- `source.source === "local"`,
- the source plugin directory exists,
- source and plugin manifest versions match.

If the Codex cache is missing or differs from the local source, the script may call `sync-codex-plugin-cache.mjs`. Existing `diff -qr` verification remains valid for Codex because the cache is a local-source snapshot.

### Claude Code

Claude handling is provenance-aware:

- If `claude` is available, run the official CLI path:
  - `claude plugin validate <repo-root>`
  - `claude plugin validate <plugin-dir>`
  - `claude plugin marketplace update <marketplace-name>`
  - `claude plugin update <plugin-name>@<marketplace-name> --scope user` when a
    user-scope install exists
  - `claude plugin install <plugin-name>@<marketplace-name> --scope user` when
    no user-scope install exists and Agent Trigger Kit itself should be
    installed at user scope
  - `claude plugin list --json`
- If `claude` is unavailable, do not mutate Claude state. Print the filesystem
  fallback report and official next steps from the canonical `actions` array.
- If the Claude marketplace source is `git`, do not copy local files into the marketplace clone or cache.
- If the Claude marketplace source is `directory` or local path, this spec still remains report-only when the CLI is unavailable. Filesystem mutation for directory-sourced Claude plugins is deferred to a separate design.

Agent Trigger Kit itself is Git-sourced in Claude Code, so the directory-source branch is not expected to apply to this plugin. It is relevant for generated project ops plugins such as `stock-scanner-ops`, where `known_marketplaces.json` may point at a project directory.

### Scope

For Agent Trigger Kit itself, the default update target is user scope.

If installed metadata also contains project/local entries, `update-local-agent-triggers.mjs` reports them but does not modify them. A future `--all-scopes` option may explicitly update multiple scopes through the official CLI only. This spec does not add `--all-scopes`.

## Blockers And Warnings

Blockers prevent write actions only. They must not prevent reports.

Claude blockers:

- Git-sourced marketplace clone has dirty files.

Claude warnings:

- Project/local scope entries exist. They are reported but not update targets in
  this spec.
- Active `.in_use` markers exist on cache paths.
- `.orphaned_at` markers exist on cache paths.
- Install paths are missing or empty.

Codex blockers:

- Codex marketplace source is not local.
- Source plugin directory is missing.
- Source plugin manifest version does not match marketplace version.

When a blocker is detected, the script reports the blocker, prints the next manual or official CLI action, and exits according to the exit-code policy.

## Human Output

Human output should answer three questions in order:

1. What is the expected source version?
2. What does each surface currently expose?
3. What should the operator run next?

For Claude CLI unavailable cases, output must include copyable commands derived
from the canonical `actions` array. If a user-scope install already exists,
prefer:

```bash
claude plugin marketplace update agent-trigger-kit
claude plugin update agent-trigger-kit@agent-trigger-kit --scope user
```

If no user-scope install exists, recommend `claude plugin install
agent-trigger-kit@agent-trigger-kit --scope user` instead of `update`.

If a dirty Git marketplace clone is detected, output must name the clone path and dirty files. It may suggest repairing the clone with a clean re-clone or official Claude marketplace update from a shell where `claude` is available. It must not suggest copying the local working tree into the clone.

## Tests

Add tests around the new probe and script behavior.

### Probe Tests

- Detects `claude` unavailable with no home as `not-initialized`.
- Detects `claude` unavailable with a Claude home as `path-missing-with-home`.
- Reads installed Claude entries from `installed_plugins.json`.
- Marks install path missing.
- Marks install path empty.
- Marks install path with `.orphaned_at`.
- Marks install path with `.in_use` entries.
- Separates marketplace `headSha` from installed `gitCommitSha`.
- Reports dirty marketplace files separately from `headDiffersFromInstalledSha`.

### Version Check Tests

- `--surface claude --json` falls back to metadata when `claude` is unavailable.
- Fallback entry reports `hasExpectedVersion: true` when metadata version matches source.
- Fallback entry reports stale state and sets `versionMismatch: true` when metadata version differs.
- Fallback sets `versionMismatch: true` when metadata version matches but the
  expected install path is missing or empty.
- Fallback does not diff local checkout against Claude cache.
- Fallback includes official Claude next steps as well-formed top-level
  `actions` entries with `surface`, `kind`, `command`, `reason`, and
  `requiresCli`.
- `--strict-installed` exits nonzero for stale or unusable fallback state.
- Existing Codex JSON fields remain compatible.

### Local Agent Sync Tests

- Codex local-source cache sync still runs for missing or stale Codex cache.
- Existing trigger-layer validation still runs before sync decisions.
- Codex prompt-input verification still runs after sync unless
  `--no-codex-debug` is passed or the Codex CLI is unavailable.
- Claude CLI unavailable produces a report and does not write to mocked Claude directories.
- Claude Git-source marketplace never triggers file copy.
- Dirty Claude marketplace clone blocks write actions but not reporting.
- `.in_use` and `.orphaned_at` cache markers are reported as warnings and do not
  block official Claude CLI actions.
- Project/local Claude scopes are reported but not updated by default.
- Official Claude CLI path is invoked when a mock `claude` executable is available.
- Official Claude CLI path recommends `install --scope user` instead of
  `update --scope user` when no user-scope install exists.

Tests must use temporary homes and mocked PATH entries. They must not read or write the real user's `~/.claude` or `~/.codex`.

## Documentation And Release

Implementation should update:

- `README.md`: explain provenance-aware sync behavior, Claude CLI unavailable fallback, and why Git-sourced Claude cache is report-only.
- `plugins/agent-trigger-kit/skills/version-check/SKILL.md`: teach agents to use filesystem fallback reporting and to provide official next-step commands.
- `plugins/agent-trigger-kit/skills/claude-plugin-lifecycle/SKILL.md`: document the Git-source provenance boundary and dirty clone recovery guidance.
- `plugins/agent-trigger-kit/skills/codex-plugin-marketplace/SKILL.md`: keep Codex local cache behavior explicitly local-source-only if needed.
- `CHANGELOG.md`: record the behavior change.

Because this touches plugin-visible skills and user-facing sync behavior, implementation must bump aligned plugin versions in:

- `package.json`
- `.agents/plugins/marketplace.json`
- `plugins/agent-trigger-kit/.codex-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `plugins/agent-trigger-kit/.claude-plugin/plugin.json`

## Definition Of Done

- Shared probe exists and is used by both version check and local sync scripts.
- Claude filesystem fallback is read-only and covered by tests.
- `update-local-agent-triggers.mjs` never writes to `~/.claude/**` except through official `claude` CLI commands.
- JSON schema additions are documented and tested.
- Human output includes copyable official commands for surfaces that cannot be updated in the current shell.
- Dirty clone, orphan, missing path, empty path, and active `.in_use` states are reported.
- Project/local Claude scopes are reported but not modified by default.
- `npm test` passes.
- `npm run validate` passes.
- `npm run ops:plugin-version-check -- --surface source agent-trigger-kit` passes.
- Aligned plugin version bump is included if plugin-visible files changed.

## Recovery Note For Existing Dirty Claude Marketplace Clones

This spec does not automatically repair dirty Claude marketplace clones.

If a clone such as `~/.claude/plugins/marketplaces/agent-trigger-kit` has Git `HEAD` at one commit but modified files from another checkout, the new probe should report:

- clone path,
- `headSha`,
- dirty files,
- installed metadata `gitCommitSha` values,
- official-command actions or manual re-clone guidance.

The repair itself should be an explicit operator action. Automatic repair is intentionally excluded because the clone belongs to Claude Code plugin management, not Agent Trigger Kit's local sync path.
