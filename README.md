# Agent Trigger Kit

[![CI](https://github.com/CCC0509/agent-trigger-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/CCC0509/agent-trigger-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](package.json)

Cross-agent trigger layer toolkit for projects that want the same operating
rules to be discoverable in Codex, Claude Code, and Cursor without copying long
SOP text into every surface.

Agent Trigger Kit keeps long project playbooks canonical in your repo, then
generates thin wrappers for the agent surfaces that need to discover them:
Codex skills, Claude Code skills and slash commands, Cursor rules, and pointer
docs.

## Quick Start

1. Install Agent Trigger Kit so your agent can discover `agent-trigger-kit:*`
   skills.

   ```bash
   codex plugin marketplace add CCC0509/agent-trigger-kit
   codex debug prompt-input "test"

   claude plugin marketplace add CCC0509/agent-trigger-kit --scope user
   claude plugin install agent-trigger-kit@agent-trigger-kit --scope user
   ```

2. Create a project trigger layer without cloning this repo.

   ```bash
   npx --yes github:CCC0509/agent-trigger-kit init \
     --root /path/to/project \
     --plugin <project>-ops \
     --tasks docs-review,deploy-ops,data-debugging \
     --playbook docs/agent-playbooks/<project>-ops.md
   ```

3. Validate the generated layer.

   ```bash
   npx --yes github:CCC0509/agent-trigger-kit validate --root /path/to/project
   ```

## How It Works

```text
docs/agent-playbooks/<project>-ops.md
  -> plugins/<project>-ops>/skills/*/SKILL.md
  -> plugins/<project>-ops>/commands/*.md
  -> .agents/plugins/marketplace.json
  -> .claude-plugin/marketplace.json
  -> .cursor/rules/*.mdc
```

The playbook remains the source of truth. Generated skills, commands, Cursor
rules, and pointer docs should stay short: they route the agent to the playbook,
name the trigger conditions, and list only the checklist items needed to avoid
misrouting.

## What This Provides

- Codex marketplace manifest and skills.
- Claude Code marketplace manifest, skills, and thin slash-command shims.
- Cursor rule templates.
- Project-local trigger-layer scaffolding.
- Drift validation for skills, commands, marketplace manifests, and Cursor
  rules.
- Version and cache checks for release and update confidence.
- Claude plugin lifecycle guidance for stale cache, missing slash commands,
  version bumps, and `.orphaned_at`.

## CLI

The `agent-trigger-kit` command is a thin dispatcher over the existing scripts.
The GitHub `npx` form works before an npm package is published.

```bash
npx --yes github:CCC0509/agent-trigger-kit --help
npx --yes github:CCC0509/agent-trigger-kit init \
  --root /path/to/project \
  --plugin <project>-ops \
  --tasks docs-review \
  --playbook docs/agent-playbooks/<project>-ops.md
npx --yes github:CCC0509/agent-trigger-kit validate --root /path/to/project
npx --yes github:CCC0509/agent-trigger-kit version-check \
  --root <agent-trigger-kit-checkout> \
  agent-trigger-kit
```

From a local checkout, use the scripts directly:

```bash
npm test
npm run validate
npm run ops:plugin-version-check -- agent-trigger-kit
npm run ops:local-agent-sync -- agent-trigger-kit
```

## Install For Agent Discovery

From GitHub:

```bash
codex plugin marketplace add CCC0509/agent-trigger-kit
codex debug prompt-input "test"

claude plugin marketplace add CCC0509/agent-trigger-kit --scope user
claude plugin install agent-trigger-kit@agent-trigger-kit --scope user
```

Confirm the Codex prompt input includes `agent-trigger-kit:*` skills. Restart
Claude Code after install so skills and slash commands are loaded.

### Install Scope Notes

Agent Trigger Kit itself is intentionally installed at user scope so agents can
discover `agent-trigger-kit:*` skills across projects.

Generated project ops plugins are different: keep them local to the consuming
project. Gate 0 smoke checks on 2026-05-20 found that Claude Code does not
auto-discover an in-repo `.claude-plugin/marketplace.json`; when you need the
generated Claude skills or slash commands, explicitly add the project
marketplace and install the generated plugin with project scope. Codex currently
has no project-scoped plugin enablement; `codex plugin marketplace add` writes
to `$CODEX_HOME/config.toml` (normally `~/.codex/config.toml`), so project ops
plugin checks must be temporary and followed by cleanup.

From a local checkout during development:

```bash
AGENT_TRIGGER_KIT_ROOT=<agent-trigger-kit-checkout>

codex plugin marketplace add "$AGENT_TRIGGER_KIT_ROOT"
codex debug prompt-input "test"

claude plugin marketplace add "$AGENT_TRIGGER_KIT_ROOT" --scope user
claude plugin install agent-trigger-kit@agent-trigger-kit --scope user
```

## Use In A Project

Create a conservative project-local trigger layer:

```bash
npx --yes github:CCC0509/agent-trigger-kit init \
  --root /path/to/project \
  --plugin <project>-ops \
  --tasks docs-review,deploy-ops,data-debugging \
  --playbook docs/agent-playbooks/<project>-ops.md
```

### Optional Document Header Checks

`agent-trigger-kit validate` can enforce project-owned document header
policies from `.agent-trigger-kit/generated.json`. The feature is off when the
generated plugin entry has no `headerChecks` array.

Example plugin-entry config:

```json
"headerChecks": [
  {
    "name": "superpowers-plan-lifecycle",
    "globs": ["docs/superpowers/specs/*.md", "docs/superpowers/plans/*.md"],
    "headerLines": 6,
    "requirePattern": "^Status: ",
    "exclude": ["docs/plans/**"]
  }
]
```

Keep globs scoped to the document types you intend to validate, such as
Markdown files, so broad patterns do not include unrelated files.

Each matched file must contain a line matching `requirePattern` within the
first `headerLines` lines. Failures look like:

```text
MISSING header in docs/superpowers/plans/example.md (check: superpowers-plan-lifecycle)
```

For greenfield projects that intentionally use Superpowers spec/plan lifecycle
headers, scaffold the active config explicitly:

```bash
npx --yes github:CCC0509/agent-trigger-kit init \
  --root /path/to/project \
  --plugin <project>-ops \
  --tasks docs-review \
  --playbook docs/agent-playbooks/<project>-ops.md \
  --with-superpowers-gate
```

Agent Trigger Kit does not hard-code Superpowers status values. Projects that
want enum enforcement should express it in `requirePattern`.

### Playbook-First Guidance

Generated skills include playbook-first guidance. For tasks covered by the
project trigger layer, the project playbook is the source of truth and generic
helper guidance should align with it instead of overriding it.

That signal is added to generated skill descriptions and skill checklists only.
Claude command shims and Cursor path rules remain thin routing surfaces.

Use task descriptions when task names alone are too sparse for reliable
discovery:

```bash
npx --yes github:CCC0509/agent-trigger-kit init \
  --root /path/to/project \
  --plugin <project>-ops \
  --tasks docs-review,deploy-ops \
  --playbook docs/agent-playbooks/<project>-ops.md \
  --task-descriptions '{"docs-review":"Use for docs, playbooks, todo, done-log, review-log, and docs-only closeout."}'
```

Task descriptions with punctuation are rendered as quoted frontmatter strings
in generated `SKILL.md` files; that is expected and keeps YAML valid.

If the playbook file is missing, the generator creates a short canonical
placeholder at that path. Edit that playbook with the real project rules;
generated skills, commands, Cursor rules, and pointer docs should remain thin.
Playbook refs with anchors use simplified heading slugs: lowercase, trimmed,
whitespace runs as hyphens, and only `a-z`, `0-9`, and hyphen kept.
The generator also writes `.agent-trigger-kit/MAINTENANCE.md` and
`.agent-trigger-kit/generated.json`; keep both in git so future validation,
safe regeneration, and migration flows can tell which files are managed.
Generated file checksums are SHA-256 hashes of the file bytes written to disk;
playbooks, marketplace manifests, and `generated.json` itself are not listed as
managed files.

Existing plugin versions are preserved on re-init, including partial recovery
when only one plugin surface exists. Use `--initial-version <version>` only for
a brand-new trigger layer with no existing plugin version.

Import existing Claude Code skills into the same trigger-layer shape:

```bash
npx --yes github:CCC0509/agent-trigger-kit import-claude-skills \
  --root /path/to/project \
  --source .claude/skills \
  --plugin <project>-ops \
  --playbook docs/agent-playbooks/<project>-ops.md
```

The importer preserves each source skill description on the generated Codex and
Claude skill wrappers, moves each skill body into a `## <task>` section in the
canonical playbook, and generates the same Codex skills, Claude skills, Claude
slash-command shims, Cursor rules, marketplaces, maintenance contract, and
generated manifest surfaces as `init`.

After a successful import, source skill directories are deleted by default so
the project has one canonical playbook plus thin trigger wrappers. Pass
`--keep-source` to preserve the original `.claude/skills/<task>` directories.
Existing playbook task sections are protected; pass
`--replace-playbook-section` only when you intentionally want the imported body
to replace an existing `## <task>` section. The importer warns when copied skill
bodies mention Claude-only tool names such as `TodoWrite` or `Task`; rewrite
those playbook sections in cross-agent terms before relying on them from Codex
or Cursor.

Cursor has no plugin marketplace in this toolkit. Generate repo-local rules
with path globs:

```bash
npx --yes github:CCC0509/agent-trigger-kit init \
  --root /path/to/project \
  --plugin <project>-ops \
  --tasks docs-review,deploy-ops,data-debugging \
  --playbook docs/agent-playbooks/<project>-ops.md \
  --cursor-globs 'docs/**,README.md'
```

Validate a project trigger layer:

```bash
npx --yes github:CCC0509/agent-trigger-kit validate --root /path/to/project
```

### Consumer Trigger Layer Lifecycle

Before updating an existing generated project trigger layer, write down the
target repo path, current working directory, plugin name, canonical playbook
path, generated manifest path, agent surfaces in scope, and Agent Trigger Kit
source or installed version used for generation. If those values cannot be
named, stop before writing files or running install/update commands.

Use the same pinned Agent Trigger Kit source for generation and static
validation. Do not let CI float on the GitHub default branch:

```bash
KIT_SPEC=github:CCC0509/agent-trigger-kit#<tag-or-commit>
npx --yes "$KIT_SPEC" validate --root <target-repo>
npx --yes "$KIT_SPEC" version-check \
  --root <target-repo> \
  --surface source \
  <plugin-name>
npx --yes "$KIT_SPEC" validate \
  --root <target-repo> \
  --require-version-bump \
  --base main
```

Use `--require-version-bump` when the branch changes generated skills, generated
commands, plugin manifests, or marketplace entries for the plugin. Wrapper typo
fixes are still plugin-visible changes and still need the aligned plugin version
bump.

Live discovery is a manual release checklist, not a CI gate. The canonical
checklist lives in `agent-trigger-kit:cross-agent-trigger-layer`; README and
consumer project docs should point there instead of duplicating it.

Load the generated project plugin for Claude Code only when the project wants
Claude skills or slash commands to appear. Run these commands from the
consuming project root so project-scope state is written to that project:

```bash
cd /path/to/project
claude plugin validate /path/to/project
claude plugin marketplace add /path/to/project --scope project
claude plugin install <project>-ops@<project>-ops --scope project
claude plugin list --json
```

The installed plugin should report `"scope": "project"` and the expected
`projectPath`. The project-scope enablement is stored in the consuming project,
not in this kit repo.

For Codex, `.agents/plugins/marketplace.json` is a project-local manifest but
not a project-scoped enablement mechanism. If you temporarily add a generated
project marketplace to inspect Codex discovery, remove it afterwards and confirm
no enabled plugin config remains:

```bash
codex plugin marketplace add /path/to/project
codex debug prompt-input "test"
codex plugin marketplace remove <project>-ops
rg '<project>-ops' ~/.codex/config.toml
```

The final `rg` should have no active config match. If a
`[plugins."<project>-ops@<project>-ops"]` block remains, remove that global
entry before leaving the project.

## Agent-Assisted Setup

Paste this into an agent while it is working inside the target project:

```text
Install `CCC0509/agent-trigger-kit` at user scope if it is not already
available. Use `agent-trigger-kit:cross-agent-trigger-layer` to create or update
a project-local trigger layer for this repo.

Before generating files, inspect the current repo for existing trigger-layer
surfaces:

- `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`
- `.agents/plugins/marketplace.json`
- `.claude-plugin/marketplace.json`
- `plugins/<plugin-name>/skills/*/SKILL.md`
- `plugins/<plugin-name>/commands/*.md`
- `.cursor/rules/*.mdc`
- the canonical playbook path

Report what already exists and preserve the canonical playbook as the source of
truth. Do not copy long SOP text into generated wrappers.

Canonical playbook: `docs/agent-playbooks/<project>-ops.md`
Plugin name: `<project>-ops`
Tasks: `<comma-separated-task-names>`
Cursor globs: `<path globs, for example docs/**,README.md>`

Generate or update Codex marketplace files, Claude marketplace files, Claude
slash-command shims, Cursor rules, and short AGENTS / CLAUDE / GEMINI pointer
snippets when appropriate. Keep every generated skill, command, Cursor rule,
and pointer doc as a thin delegate to the canonical playbook.

Keep install scope explicit: Agent Trigger Kit itself is the user-scope tool;
the generated `<project>-ops` plugin belongs to this project. Use Claude
project scope for generated plugin installs. For Codex, there is no project
plugin scope, so only add the generated marketplace temporarily for verification
and then remove the global config entry.

After scaffolding, run:

`npx --yes github:CCC0509/agent-trigger-kit validate --root .`

Report the generated files, validation result, and any follow-up needed.
```

## Update Existing Users

**Users before 0.1.2:** older installed snapshots do not include
`agent-trigger-kit:version-check`. Run the manual update commands first, then
ask the version question again after restarting Claude Code.

**Plugin users:** update the Codex and Claude marketplace installation and
cache.

```bash
codex plugin marketplace upgrade agent-trigger-kit
codex debug prompt-input "test"

claude plugin marketplace update agent-trigger-kit
claude plugin update agent-trigger-kit@agent-trigger-kit --scope user
```

Restart Claude Code after update. If Claude reports the plugin is already
latest but commands or skills are stale, uninstall and reinstall:

```bash
claude plugin uninstall agent-trigger-kit@agent-trigger-kit --scope user
claude plugin install agent-trigger-kit@agent-trigger-kit --scope user
```

**Repo checkout users:** pull the latest scripts, README, and validator
changes.

```bash
cd <agent-trigger-kit-checkout>
git pull
npm test
npm run validate
npm run ops:local-agent-sync -- agent-trigger-kit
```

**Projects that already generated a trigger layer:** generated project-local
files do not update automatically. Validate first, then regenerate only if the
project should adopt the newer wrapper shape.
`.agent-trigger-kit/MAINTENANCE.md` is created only when missing; re-running
`init`, including `init --force`, does not overwrite an existing maintenance
contract. Copy new maintenance reminders into existing projects manually when
they matter.

```bash
npx --yes github:CCC0509/agent-trigger-kit validate --root /path/to/project
```

## Check Your Version

After 0.1.2, you can ask the agent directly:

```text
請問 Agent Trigger Kit 是最新版本嗎？
幫我檢查 agent-trigger-kit 是否需要更新。
Is the kit version current?
```

Claude Code users can also run:

```text
/agent-trigger-kit-version
```

From an Agent Trigger Kit checkout, use the narrowest read-only check for the
question:

```bash
npm run ops:plugin-version-check -- --surface source agent-trigger-kit
npm run ops:plugin-version-check -- --surface codex agent-trigger-kit
npm run ops:plugin-version-check -- --surface claude agent-trigger-kit
npm run ops:plugin-version-check -- --surface all agent-trigger-kit
```

Use `--surface source` for source manifests only, `codex` for Codex cache state,
`claude` for Claude installed state, and `all` only when the question is
cross-agent. Add `--json` for automation:

```bash
npm run ops:plugin-version-check -- --surface codex --json agent-trigger-kit
npm run ops:plugin-version-check -- --surface claude --claude-home /tmp/claude-home --json agent-trigger-kit
```

When `claude` is unavailable in the current shell, `--surface claude` and
`--surface all` fall back to read-only Claude metadata under `~/.claude`. The
report names installed entries, cache health warnings, and official commands to
run from a shell where `claude` is available. Agent Trigger Kit does not copy
local working tree files into Git-sourced Claude plugin caches.

Use strict installed-state checking when you want stale checked surfaces to fail
the command:

```bash
npm run ops:plugin-version-check -- --surface all --strict-installed agent-trigger-kit
```

Expected source versions must match across both marketplace manifests and both
plugin manifests. `package.json` is included only when its `name` is the plugin
name or a scoped package ending in `/<plugin-name>`, such as `@acme/demo-ops`
for `demo-ops`. Use `--include-package` or `--no-include-package` to override
that detection.

## Maintainer Workflows

Bump the aligned version before commit and before push whenever plugin-visible
files change, including plugin skills, commands, marketplace manifests, or
plugin manifests. This gives installed caches a fresh snapshot instead of
reusing a same-version cache.

Bump a plugin version:

```bash
node scripts/bump-plugin-version.mjs \
  --root /path/to/project \
  --plugin <plugin-name> \
  --version 0.1.1
```

The bump command uses the same package detection as `version-check`: external
project package versions are left alone unless `package.json.name` matches the
plugin name, ends in `/<plugin-name>`, or `--include-package` is passed. Use
`--no-include-package` for monorepos or unusual package naming where package
and trigger-layer versions should stay decoupled.

Use `--surface codex` or `--surface claude` only as an advanced cache-repair
escape hatch. Partial surface bumps emit a warning and do not keep release
versions aligned.

Sync a project-local Codex plugin cache snapshot after bumping or editing a
local plugin:

```bash
node scripts/sync-codex-plugin-cache.mjs \
  --root /path/to/project \
  <plugin-name>
```

Before publishing or tagging:

```bash
npm test
npm run validate
npm run ops:plugin-version-check -- agent-trigger-kit
claude plugin validate .
claude plugin validate plugins/agent-trigger-kit
```

Run the `/private/tmp` smoke flow from this README's project examples when
generator behavior changes.

## Troubleshooting

- Missing Claude slash commands: run `claude plugin validate <repo-root>` and
  `claude plugin validate <repo-root>/plugins/<plugin-name>`, confirm
  `commands/*.md` exists and `.claude-plugin/plugin.json` declares
  `"commands": ["./commands/"]`, bump the Claude plugin version, update or
  reinstall, then restart Claude Code.
- Missing Codex skills: add the marketplace root, not the plugin subdirectory,
  then run `codex debug prompt-input "test"` and check for the expected
  `plugin-name:*` skills. If the marketplace is present but skills are absent,
  confirm `~/.codex/config.toml` enables the plugin.
- Validator reports a missing canonical playbook: create the referenced
  playbook or rerun the init script. Do not move the long rules into skills,
  commands, or Cursor rules.
- Cursor drift: regenerate or edit `.cursor/rules/*.mdc` with YAML-list
  `globs`; Cursor does not install from this marketplace.

## Project Links

- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Design Rule

The project playbook remains canonical. Skills, slash commands, Cursor rules,
and pointer docs are trigger layers only. They should contain routing,
must-read references, and short checklists, not duplicated SOP bodies.
