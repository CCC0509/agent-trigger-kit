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

From GitHub after publishing:

```bash
codex plugin marketplace add CCC0509/agent-trigger-kit
claude plugin marketplace add CCC0509/agent-trigger-kit --scope user
claude plugin install agent-trigger-kit@agent-trigger-kit --scope user
```

From a local checkout:

```bash
codex plugin marketplace add /Users/rd/projects/agent-trigger-kit
claude plugin marketplace add /Users/rd/projects/agent-trigger-kit --scope user
claude plugin install agent-trigger-kit@agent-trigger-kit --scope user
```

Claude Code slash commands require restarting Claude Code after install or update.

## Use In A Project

Create a conservative project-local trigger layer:

```bash
node scripts/init-project-trigger-layer.mjs \
  --root /path/to/project \
  --plugin stock-scanner-ops \
  --tasks docs-review,deploy-ops,data-debugging \
  --playbook docs/agent-playbooks/stock-scanner-ops.md
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

## Design Rule

The project playbook remains canonical. Skills, slash commands, Cursor rules, and pointer docs are trigger layers only. They should contain routing, must-read references, and short checklists, not duplicated SOP bodies.
