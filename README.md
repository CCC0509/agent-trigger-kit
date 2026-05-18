# Agent Trigger Kit

Cross-agent trigger layer toolkit for projects that want the same operating rules to be discoverable in Codex, Claude Code, and Cursor without copying long SOP text into every surface.

## What This Provides

- Codex marketplace manifest and skills.
- Claude Code marketplace manifest, skills, and thin slash-command shims.
- Cursor rule templates.
- Project-local trigger-layer scaffolding.
- Drift validation for skills, commands, marketplace manifests, and Cursor rules.
- Claude plugin lifecycle guidance for stale cache, missing slash commands, version bumps, and `.orphaned_at`.

## Install

From GitHub after publishing the repo:

```bash
codex plugin marketplace add CCC0509/agent-trigger-kit
codex debug prompt-input "test"

claude plugin marketplace add CCC0509/agent-trigger-kit --scope user
claude plugin install agent-trigger-kit@agent-trigger-kit --scope user
```

Confirm the Codex prompt input includes `agent-trigger-kit:*` skills. Restart Claude Code after install so skills and slash commands are loaded.

From a local checkout during development:

```bash
codex plugin marketplace add /Users/rd/projects/agent-trigger-kit
codex debug prompt-input "test"

claude plugin marketplace add /Users/rd/projects/agent-trigger-kit --scope user
claude plugin install agent-trigger-kit@agent-trigger-kit --scope user
```

## Update

Codex marketplace sources are updated with:

```bash
codex plugin marketplace upgrade agent-trigger-kit
codex debug prompt-input "test"
```

Claude marketplace and plugin cache are updated separately:

```bash
claude plugin marketplace update agent-trigger-kit
claude plugin update agent-trigger-kit@agent-trigger-kit --scope user
```

Restart Claude Code after update. If Claude reports the plugin is already latest but commands or skills are stale, uninstall and reinstall:

```bash
claude plugin uninstall agent-trigger-kit@agent-trigger-kit --scope user
claude plugin install agent-trigger-kit@agent-trigger-kit --scope user
```

## Use In A Project

Create a conservative project-local trigger layer from a checkout of this repo:

```bash
node scripts/init-project-trigger-layer.mjs \
  --root /path/to/project \
  --plugin stock-scanner-ops \
  --tasks docs-review,deploy-ops,data-debugging \
  --playbook docs/agent-playbooks/stock-scanner-ops.md
```

If the playbook file is missing, the generator creates a short canonical placeholder at that path. Edit that playbook with the real project rules; generated skills, commands, Cursor rules, and pointer docs should remain thin.

Cursor has no plugin marketplace in this toolkit. Generate repo-local rules with path globs:

```bash
node scripts/init-project-trigger-layer.mjs \
  --root /path/to/project \
  --plugin stock-scanner-ops \
  --tasks docs-review,deploy-ops,data-debugging \
  --playbook docs/agent-playbooks/stock-scanner-ops.md \
  --cursor-globs 'docs/**,README.md'
```

Validate a project trigger layer:

```bash
node scripts/validate-trigger-layer.mjs --root /path/to/project
```

Bump a plugin version after changing Claude commands or lifecycle-sensitive manifest behavior:

```bash
node scripts/bump-plugin-version.mjs \
  --root /path/to/project \
  --plugin stock-scanner-ops \
  --version 0.1.1 \
  --surface claude
```

## Troubleshooting

- Missing Claude slash commands: run `claude plugin validate <repo-root>` and `claude plugin validate <repo-root>/plugins/<plugin-name>`, confirm `commands/*.md` exists and `.claude-plugin/plugin.json` declares `"commands": ["./commands/"]`, bump the Claude plugin version, update or reinstall, then restart Claude Code.
- Missing Codex skills: add the marketplace root, not the plugin subdirectory, then run `codex debug prompt-input "test"` and check for the expected `plugin-name:*` skills. If the marketplace is present but skills are absent, confirm `~/.codex/config.toml` enables the plugin:

  ```toml
  [plugins."agent-trigger-kit@agent-trigger-kit"]
  enabled = true
  ```

- Validator reports a missing canonical playbook: create the referenced playbook or rerun the init script. Do not move the long rules into skills, commands, or Cursor rules.
- Cursor drift: regenerate or edit `.cursor/rules/*.mdc` with YAML-list `globs`; Cursor does not install from this marketplace.

## Publish Checklist

Before publishing or tagging:

```bash
npm test
node scripts/validate-trigger-layer.mjs --root .
claude plugin validate .
claude plugin validate plugins/agent-trigger-kit
```

Run the `/private/tmp` smoke flow from this README's project examples when generator behavior changes. If Claude-visible plugin files change, especially commands or `.claude-plugin/plugin.json`, bump the plugin version in both `.claude-plugin/marketplace.json` and `plugins/agent-trigger-kit/.claude-plugin/plugin.json` so marketplace caches take a fresh snapshot.

## Design Rule

The project playbook remains canonical. Skills, slash commands, Cursor rules, and pointer docs are trigger layers only. They should contain routing, must-read references, and short checklists, not duplicated SOP bodies.
