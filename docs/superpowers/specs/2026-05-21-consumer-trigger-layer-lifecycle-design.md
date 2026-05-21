# Consumer Trigger Layer Lifecycle Design

**Goal:** Define a small, hard lifecycle for generated project trigger layers so
Claude-skill imports and new task wrappers are validated against the right repo,
reuse Agent Trigger Kit's existing machinery, and do not create new drift
surfaces in consuming projects.

**Status:** Design spec with implementation hand-off outline. This spec has not
been implemented yet.

## Review Synthesis

Source reviewed: user-provided review text in the 2026-05-21 Codex session about
imported Claude Code skills and generated consumer trigger layers. The reviewed
proposal was not checked into this repo as a plan file. Related repo context:
`docs/superpowers/specs/2026-05-20-playbook-first-guidance-design.md`,
`docs/superpowers/specs/2026-05-20-provenance-aware-plugin-sync-design.md`, and
`docs/superpowers/plans/2026-05-21-provenance-aware-plugin-sync.md`.

The reviewed proposal diagnosed a real failure mode: a generated project can
contain the right-looking files while one or more agents cannot actually
discover the new skill, command, or rule. The proposed repair direction was
useful, but it mixed the Agent Trigger Kit repo with a consuming project such as
`stock-scanner-ops` or another imported Claude-skill repo.

That scope mismatch is the primary problem to fix. Agent Trigger Kit already
has many of the proposed validator and lifecycle pieces:

- `scripts/validate-trigger-layer.mjs` is the canonical validator in this repo.
- `pluginVersionSnapshot()` reads aligned versions from `package.json`, Codex
  marketplace, Claude marketplace, Codex plugin manifest, and Claude plugin
  manifest.
- `--require-version-bump --base <ref>` enforces version bumps for managed
  plugin-visible file changes.
- Canonical refs, maintenance contract pointers, playbook-first guidance,
  command-to-skill delegation, command declaration, and Cursor rule frontmatter
  keys are already validated.
- The playbook-first guidance design already establishes that long SOP content
  belongs in the canonical playbook, while skills, commands, and Cursor rules
  remain thin trigger wrappers.

The correct next step is therefore not to fork or hand-patch a stale consumer
validator. It is to reconcile the consuming project with the current Agent
Trigger Kit lifecycle and add the missing live-discovery checklist where static
validation cannot prove runtime visibility.

## Problem

Generated trigger layers cross several boundaries:

- The kit repo owns generator code, templates, validator rules, and reusable
  lifecycle skills.
- The consuming project owns the canonical playbook, generated plugin wrappers,
  pointer docs, and any project-local install state.
- Agent runtimes own cache snapshots and discovery behavior.

When a plan does not name the target repo and current working directory, an
agent can validate or edit the wrong layer. That creates false confidence: the
kit can be healthy while the consuming project still has stale generated files,
old versions, missing commands, or undiscoverable skills.

Static validation and runtime discovery are also different kinds of evidence.
Codex can expose prompt-input content. Claude Code can expose installed plugin
metadata, but new skills and slash commands require install/update plus a fresh
session. Cursor rules can be checked as repo-local files, but there is no
headless runtime discovery probe in this toolkit. Gemini support is not part of
the generated trigger-layer surface today.

## Non-Negotiable Scope Rule

Every downstream lifecycle plan must start by naming:

- target repo path
- current working directory
- plugin name
- canonical playbook path
- generated manifest path
- agent surfaces in scope
- Agent Trigger Kit source or installed version used for generation

If those values cannot be named, the lifecycle stops before writing files or
running install/update commands. This is an agent/operator discipline, not a
validator-enforced static check.

## Design Principles

- Reuse Agent Trigger Kit as the source of trigger-layer machinery; do not
  fork validators inside consuming projects.
- Keep the project playbook canonical. Wrappers carry triggers, must-read
  pointers, and short checklists only.
- Treat version bumps as mechanical for plugin-visible changes. Do not create
  typo exceptions that conflict with `--require-version-bump`.
- Split gates into CI-enforceable static checks and manual live discovery.
- Prefer read-only runtime probes. Global config mutation is a last-resort
  discovery step with explicit cleanup.
- Treat agent restart boundaries as part of the verification contract.
- Report failure branches, not only the happy path.

## Lifecycle Model

### 1. Scope And Reconcile

Before changing a consuming project:

1. Confirm the target repo and `cwd`.
2. Locate `.agent-trigger-kit/generated.json`.
3. Locate the canonical playbook and generated plugin directory.
4. Identify whether any project-local validator is a stale generated artifact,
   such as an older `validate-agent-trigger-layer.mjs`.
5. Prefer regeneration or resync with the current kit over hand-patching the
   stale artifact.

If a consumer has a local validator with hard-coded versions or behavior that
differs from this kit, the default repair is to run the current kit generator or
validator from the kit package. A local validator fork needs an explicit project
reason and its own tests.

### 2. Canonical Content

Imported Claude Code skill bodies move into the project playbook task sections.
Generated Codex skills, Claude skills, Claude command shims, Cursor rules, and
pointer docs stay thin.

For a task such as `karpathy-guidelines`, the canonical source is the named
project playbook section. Generated wrappers should include:

- trigger description
- must-read canonical playbook reference
- maintenance contract pointer
- concise checklist items needed to route correctly

They should not duplicate the full SOP body from the playbook.

### 3. Version Discipline

Any managed plugin-visible diff requires an aligned patch version bump before
review:

- generated skills
- generated commands
- plugin manifests
- marketplace entries for the plugin

Use:

```bash
node scripts/bump-plugin-version.mjs \
  --root <target-repo> \
  --plugin <plugin-name> \
  --version <next-patch-version>
```

When the current aligned version should simply advance by one patch release,
use:

```bash
node scripts/bump-plugin-version.mjs \
  --root <target-repo> \
  --plugin <plugin-name> \
  --next patch
```

Then run the validator with `--require-version-bump --base <ref>` from a checkout
that has the relevant Git history.

Wrapper typo fixes are still plugin-visible changes. They either get the same
mechanical bump or the team intentionally changes the validator rule; this spec
chooses the mechanical rule.

### 4. Static Gate

The CI-enforceable gate is static and must not depend on user-level agent state.
Use the same Agent Trigger Kit source or installed version named by the scope
rule. For `npx` usage, pin the GitHub package spec to a release tag or commit
SHA; do not use an unqualified `github:CCC0509/agent-trigger-kit` package spec
in CI.

`agent-trigger-kit validate` is the packaged CLI entrypoint for the same
canonical validator implemented by `scripts/validate-trigger-layer.mjs`.

It should run in the consuming project:

```bash
KIT_SPEC=github:CCC0509/agent-trigger-kit#<tag-or-commit>
npx --yes "$KIT_SPEC" validate --root <target-repo>
```

Run source version alignment explicitly when the workflow needs the five-surface
version check but no plugin-visible diff triggered `--require-version-bump`:

```bash
npx --yes "$KIT_SPEC" version-check \
  --root <target-repo> \
  --surface source \
  <plugin-name>
```

For branches that change managed plugin-visible files and have Git history:

```bash
npx --yes "$KIT_SPEC" validate \
  --root <target-repo> \
  --require-version-bump \
  --base <base-ref>
```

Static validation owns:

- manifest/plugin directory consistency
- per-surface marketplace and plugin manifest version consistency
- full five-surface version alignment when `--require-version-bump` or
  `version-check` is part of the workflow
- skill frontmatter key presence
- command frontmatter key presence
- command declaration in Claude manifest
- command delegation to existing skills
- Cursor rule frontmatter key presence and canonical refs
- canonical playbook refs and heading anchors
- maintenance contract pointers
- playbook-first guidance for flagged generated plugins

If stricter YAML parsing is needed for a consuming project, add it to Agent
Trigger Kit's validator with tests instead of creating an untracked side script.

### 5. Manual Live Discovery

Live discovery is a manual release checklist, not a CI gate.
The checklist's canonical home is
`plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md`; README or
project docs may point to it, but should not duplicate the full checklist.

Prerequisites:

- static gate passed
- version bump applied when required
- relevant plugin installed or updated
- fresh agent session after Claude Code install/update

Codex:

```bash
codex debug prompt-input "test"
```

Check for the expected `<plugin-name>:<skill-name>` entries. If a generated
project plugin must be temporarily added for discovery, record that this mutates
`~/.codex/config.toml`, remove it afterwards, and confirm the config no longer
contains the project plugin.

Claude Code:

```bash
claude plugin list --json
```

For generated project plugins, the expected install is project scope with the
target `projectPath`. If `claude plugin validate <path>` is used and hangs in a
given environment, treat the result as inconclusive and use a bounded timeout
such as 20 seconds only to keep the session from blocking. Do not make the
hanging validate command the only discovery signal.

After install or update, restart Claude Code before deciding whether skills or
slash commands are missing.

Cursor:

Cursor support is static in this toolkit. Verify `.cursor/rules/*.mdc`
frontmatter, globs, and canonical references. Do not describe Cursor as having a
headless runtime discovery gate unless a real probe is added later.

Gemini:

Gemini is out of scope unless the kit adds Gemini templates and validator rules.
Pointer link checks may be done for existing `GEMINI.md` docs, but that is not
the same as generated Gemini trigger-layer support.

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

If a live discovery step mutates user-level config and the session is interrupted,
cleanup is required before reporting completion. The final report must say
whether cleanup was verified.

## Implementation Hand-Off

This spec should be implemented as a docs-and-validator hardening pass in Agent
Trigger Kit, not as a new consumer-specific validator.

Planned kit changes:

- Add a concise lifecycle section to README or a dedicated maintainer doc that
  points to `cross-agent-trigger-layer`, `claude-plugin-lifecycle`, and
  `version-check`.
- Update `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md`
  with the scope-first lifecycle, pinned kit-source requirement, live-discovery
  checklist, and static/manual gate split.
- Update `plugins/agent-trigger-kit/skills/claude-plugin-lifecycle/SKILL.md`
  to make restart and `claude plugin list --json` the preferred discovery
  evidence when `claude plugin validate` is unreliable.
- Update `plugins/agent-trigger-kit/skills/version-check/SKILL.md` to reinforce
  read-only Codex/Claude cache inspection before any user-level config changes.
- Consider adding strict YAML frontmatter parsing to
  `scripts/validate-trigger-layer.mjs` if the existing key checks are not enough
  for generated wrappers and Cursor rules.
- Add regression tests that create an intentionally broken generated layer and
  prove the validator fails for the documented static gate.

No implementation should add a script that edits `~/.codex/config.toml` as its
default verification path. If a helper is added for live discovery, it should be
read-only by default and print any required manual mutation and cleanup steps.

## Tests

Add or extend tests in `tests/trigger-layer-scripts.test.mjs` for:

- validator failure when a generated command delegates to a missing skill
- validator failure when commands exist but are not declared in the Claude
  manifest
- validator failure when a plugin-visible managed file changes without a version
  bump under `--require-version-bump`
- validator acceptance when the same change has an aligned patch bump
- optional strict YAML frontmatter parsing, if implemented
- docs/skill text covering scope-first lifecycle, static/manual gate split,
  Claude restart boundary, Codex global config cleanup, Cursor static-only
  status, and Gemini out-of-scope status

Existing tests already cover several of these areas; implementation should
reuse or tighten those tests rather than duplicate fixtures unnecessarily.

## Out Of Scope

- Patching `stock-scanner-ops`, `yamol-dev`, or any other consuming repo without
  its path and scope explicitly provided.
- Creating a new consumer-side validator that reimplements Agent Trigger Kit.
- Treating Cursor as runtime-verifiable without a real headless probe.
- Adding Gemini trigger-layer generation.
- Copying local files into Git-sourced Claude Code plugin caches.
- Long-form lifecycle duplication inside consuming project docs.

## Acceptance Criteria

- The lifecycle documentation starts with target repo and scope confirmation.
- Static validation is clearly CI-safe and user-state-free.
- CI examples pin the Agent Trigger Kit source to the version or ref named by
  the scope rule.
- Live discovery is clearly manual, surface-specific, and restart-aware.
- The manual live-discovery checklist has one canonical home.
- The recommended repair for stale generated validators is resync/regeneration
  with the current kit, not hand-patching.
- Version bump rules are mechanical and match `--require-version-bump`.
- Consumer docs remain thin pointers to kit skills and project-specific deltas.
