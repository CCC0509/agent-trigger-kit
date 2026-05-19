# Agent Trigger Kit

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

If the playbook file is missing, the generator creates a short canonical
placeholder at that path. Edit that playbook with the real project rules;
generated skills, commands, Cursor rules, and pointer docs should remain thin.

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

## Agent-Assisted Setup

Paste this into an agent while it is working inside the target project:

```text
Install `CCC0509/agent-trigger-kit` if it is not already available. Use
`agent-trigger-kit:cross-agent-trigger-layer` to create or update a
project-local trigger layer for this repo.

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

From an Agent Trigger Kit checkout, check source versions and Codex cache
snapshots:

```bash
npm run ops:plugin-version-check -- agent-trigger-kit
npm run ops:plugin-version-check -- --json agent-trigger-kit
```

Use strict installed-state checking when you want stale local Codex or Claude
caches to fail the command:

```bash
npm run ops:plugin-version-check -- --strict-installed agent-trigger-kit
```

Expected source versions must match across `package.json`, both marketplace
manifests, and both plugin manifests.

## Maintainer Workflows

Bump a plugin version for a release:

```bash
node scripts/bump-plugin-version.mjs \
  --root <agent-trigger-kit-checkout> \
  --plugin agent-trigger-kit \
  --version 0.1.1
```

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
generator behavior changes. If Claude-visible plugin files change, especially
commands or `.claude-plugin/plugin.json`, bump the plugin version in both
`.claude-plugin/marketplace.json` and
`plugins/agent-trigger-kit/.claude-plugin/plugin.json` so marketplace caches
take a fresh snapshot.

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
