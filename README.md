# Agent Trigger Kit

Cross-agent trigger layer toolkit for projects that want the same operating rules
to be discoverable in Codex, Claude Code, and Cursor without copying long SOP
text into every surface.

## What's New

### 0.1.2 - Natural Version Check Skill

- Added `agent-trigger-kit:version-check` for natural-language questions such as
  "Is Agent Trigger Kit up to date?" or "請問 kit 的版本是最新的嗎？"
- Added `/agent-trigger-kit-version` for Claude Code users who prefer a slash
  command.
- Documented the old-user bootstrap path: users on versions before 0.1.2 must
  update first before this new skill can be discovered.

### 0.1.1 - Version Confidence And Update Flow

- Added a version check utility that compares `package.json`, Codex marketplace,
  Codex plugin, Claude marketplace, and Claude plugin versions.
- Added Codex local cache reporting so users can see which plugin snapshots are
  present locally.
- Added a clearer existing-user update path for plugin users, repo checkout
  users, and projects that already generated a trigger layer.
- Updated the copy-paste setup prompt so agents inspect existing local
  playbooks, skills, commands, Cursor rules, and pointer docs before generating
  or updating wrappers.

### 0.1.0 - Initial Toolkit

- Codex and Claude marketplace manifests.
- Claude slash-command shims that delegate to skills.
- Cursor rule templates.
- Project-local trigger-layer scaffolding and validation.

## Quick Start

1. Install Agent Trigger Kit so your agent can discover `agent-trigger-kit:*`
   skills.

   ```bash
   codex plugin marketplace add CCC0509/agent-trigger-kit
   codex debug prompt-input "test"

   claude plugin marketplace add CCC0509/agent-trigger-kit --scope user
   claude plugin install agent-trigger-kit@agent-trigger-kit --scope user
   ```

2. Choose how to create a trigger layer in a project.

   Agent-assisted setup: paste the prompt in the `Copy-paste prompt` section
   into the agent while it is working inside the target project.

   Direct CLI setup:

   ```bash
   node /path/to/agent-trigger-kit/scripts/init-project-trigger-layer.mjs \
     --root /path/to/project \
     --plugin <project>-ops \
     --tasks docs-review,deploy-ops,data-debugging \
     --playbook docs/agent-playbooks/<project>-ops.md
   ```

3. Validate the generated trigger layer.

   ```bash
   node /path/to/agent-trigger-kit/scripts/validate-trigger-layer.mjs --root /path/to/project
   ```

## Usage Modes

- **Install this kit:** make `agent-trigger-kit:*` skills available to Codex or
  Claude.
- **Scaffold a project trigger layer:** create project-local Codex manifests,
  Claude manifests, Claude command shims, Cursor rules, and pointer docs.
- **Validate drift:** check that generated skills, commands, manifests, Cursor
  rules, and canonical playbook references still line up.
- **Check versions:** confirm source manifests and local cache snapshots match
  the expected release.
- **Bump versions:** update package and plugin manifest versions together for a
  release.
- **Sync Codex local cache:** replace a stale local Codex cache snapshot with a
  fresh copy from a local marketplace source.
- **Refresh local agent triggers:** run the fixed Codex, Claude, and Cursor
  checks for a local plugin checkout without re-deciding the flow each time.
- **Troubleshoot discovery:** diagnose missing Codex skills, missing Claude
  slash commands, stale caches, or `.orphaned_at`.

## What This Provides

- Codex marketplace manifest and skills.
- Claude Code marketplace manifest, skills, and thin slash-command shims.
- Cursor rule templates.
- Project-local trigger-layer scaffolding.
- Drift validation for skills, commands, marketplace manifests, and Cursor rules.
- Version and cache checks for release/update confidence.
- Claude plugin lifecycle guidance for stale cache, missing slash commands,
  version bumps, and `.orphaned_at`.

## Install

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
codex plugin marketplace add /path/to/agent-trigger-kit
codex debug prompt-input "test"

claude plugin marketplace add /path/to/agent-trigger-kit --scope user
claude plugin install agent-trigger-kit@agent-trigger-kit --scope user
```

If a local Codex marketplace already points at this checkout but the prompt
input still shows an old cached snapshot, sync the local cache from the
marketplace manifest:

```bash
npm run ops:plugin-cache-sync -- agent-trigger-kit
codex debug prompt-input "test"
```

For the full local refresh flow, use the orchestrator from the checkout:

```bash
npm run ops:local-agent-sync -- agent-trigger-kit
```

That command validates the trigger layer, checks source and installed versions,
syncs the Codex local cache when the expected cache snapshot is missing or
differs from the local plugin source, runs
`codex debug prompt-input "test"` unless `--no-codex-debug` is passed, updates
Claude through `marketplace update` and `plugin update` when the `claude` CLI is
available, and treats Cursor as repo-local rules covered by the validator.

## Update Existing Users

There are three different things a user may need to update.

**Users before 0.1.2:** older installed snapshots do not include
`agent-trigger-kit:version-check`. Run the manual update commands first, then
ask the version question again after restarting Claude Code.

**Plugin users:** update the Codex/Claude marketplace installation and cache.

```bash
codex plugin marketplace upgrade agent-trigger-kit
codex debug prompt-input "test"

claude plugin marketplace update agent-trigger-kit
claude plugin update agent-trigger-kit@agent-trigger-kit --scope user
```

Restart Claude Code after update. If Claude reports the plugin is already latest
but commands or skills are stale, uninstall and reinstall:

```bash
claude plugin uninstall agent-trigger-kit@agent-trigger-kit --scope user
claude plugin install agent-trigger-kit@agent-trigger-kit --scope user
```

**Repo checkout users:** pull the latest scripts, README, and validator changes.

```bash
cd /path/to/agent-trigger-kit
git pull
npm test
npm run validate
npm run ops:local-agent-sync -- agent-trigger-kit
```

**Projects that already generated a trigger layer:** generated project-local
files do not update automatically. Validate first, then regenerate only if the
project should adopt the newer wrapper shape.

```bash
node /path/to/agent-trigger-kit/scripts/validate-trigger-layer.mjs --root /path/to/project
```

If regeneration is needed, inspect the diff before committing:

```bash
node /path/to/agent-trigger-kit/scripts/init-project-trigger-layer.mjs \
  --root /path/to/project \
  --plugin <project>-ops \
  --tasks <comma-separated-task-names> \
  --playbook docs/agent-playbooks/<project>-ops.md
```

Keep the canonical playbook content in the project. Do not replace it with a
generated placeholder.

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
```

Use strict installed-state checking when you want stale local Codex or Claude
caches to fail the command:

```bash
npm run ops:plugin-version-check -- --strict-installed agent-trigger-kit
```

Expected source versions must match across:

- `package.json`
- `.agents/plugins/marketplace.json`
- `plugins/agent-trigger-kit/.codex-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `plugins/agent-trigger-kit/.claude-plugin/plugin.json`

Codex cache versions are reported from:

```text
~/.codex/plugins/cache/agent-trigger-kit/agent-trigger-kit/
```

Then confirm the active prompt input includes the expected skills:

```bash
codex debug prompt-input "test"
```

Claude installed/cache state is checked with:

```bash
claude plugin list --json
claude plugin validate /path/to/agent-trigger-kit
claude plugin validate /path/to/agent-trigger-kit/plugins/agent-trigger-kit
```

If `claude` is unavailable in the current shell, run those commands in a Claude
Code environment.

## Use In A Project

Create a conservative project-local trigger layer from a checkout of this repo:

```bash
node scripts/init-project-trigger-layer.mjs \
  --root /path/to/project \
  --plugin <project>-ops \
  --tasks docs-review,deploy-ops,data-debugging \
  --playbook docs/agent-playbooks/<project>-ops.md
```

If the playbook file is missing, the generator creates a short canonical
placeholder at that path. Edit that playbook with the real project rules;
generated skills, commands, Cursor rules, and pointer docs should remain thin.

Cursor has no plugin marketplace in this toolkit. Generate repo-local rules with
path globs:

```bash
node scripts/init-project-trigger-layer.mjs \
  --root /path/to/project \
  --plugin <project>-ops \
  --tasks docs-review,deploy-ops,data-debugging \
  --playbook docs/agent-playbooks/<project>-ops.md \
  --cursor-globs 'docs/**,README.md'
```

Copy-paste prompt for asking an agent to set up or update a project:

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

`node <path-to-agent-trigger-kit>/scripts/validate-trigger-layer.mjs --root .`

Report the generated files, validation result, and any follow-up needed.
```

Validate a project trigger layer:

```bash
node scripts/validate-trigger-layer.mjs --root /path/to/project
```

Bump a plugin version for a release:

```bash
node scripts/bump-plugin-version.mjs \
  --root /path/to/agent-trigger-kit \
  --plugin agent-trigger-kit \
  --version 0.1.1
```

Sync a project-local Codex plugin cache snapshot after bumping or editing a
local plugin:

```bash
node scripts/sync-codex-plugin-cache.mjs \
  --root /path/to/project \
  <plugin-name>
```

## Release Rules

- README-only changes may leave plugin versions unchanged.
- Repo tool changes, such as `scripts/`, tests, or validator behavior, should
  bump `package.json`.
- Plugin-visible changes, such as skills, commands, Codex manifests, or Claude
  manifests, should bump `package.json` and all Codex/Claude plugin manifests.
- For now, keep `package.json` and all four plugin/marketplace manifest versions
  aligned for releases.
- Update `What's New` whenever a release changes user-visible behavior.

## Troubleshooting

- Missing Claude slash commands: run `claude plugin validate <repo-root>` and
  `claude plugin validate <repo-root>/plugins/<plugin-name>`, confirm
  `commands/*.md` exists and `.claude-plugin/plugin.json` declares
  `"commands": ["./commands/"]`, bump the Claude plugin version, update or
  reinstall, then restart Claude Code.
- Missing Codex skills: add the marketplace root, not the plugin subdirectory,
  then run `codex debug prompt-input "test"` and check for the expected
  `plugin-name:*` skills. If the marketplace is present but skills are absent,
  confirm `~/.codex/config.toml` enables the plugin:

  ```toml
  [plugins."agent-trigger-kit@agent-trigger-kit"]
  enabled = true
  ```

- Validator reports a missing canonical playbook: create the referenced playbook
  or rerun the init script. Do not move the long rules into skills, commands, or
  Cursor rules.
- Cursor drift: regenerate or edit `.cursor/rules/*.mdc` with YAML-list `globs`;
  Cursor does not install from this marketplace.

## Publish Checklist

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

## Design Rule

The project playbook remains canonical. Skills, slash commands, Cursor rules,
and pointer docs are trigger layers only. They should contain routing, must-read
references, and short checklists, not duplicated SOP bodies.
