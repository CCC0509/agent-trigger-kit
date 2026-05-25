# Agent Trigger Kit Agent Instructions

## Session Start

- Before making changes in this repo, run `agent-trigger-kit session-check`.

## Session Closeout

- Before reporting completion, run `agent-trigger-kit session-check --closeout`.
- Mark or report unmarked events before leaving the session.

## Before Commit And Push

- Run `npm run preflight` before any commit or push. It runs ESLint,
  `prettier --check .`, tests, `validate`, and the scratch-namespace check —
  the same gates CI enforces.
- CI fails on `prettier --check .` for any unformatted tracked file, including
  docs-only changes (`.md`, `.json`, `.mjs`). Run `npm run format` to fix
  formatting before pushing rather than discovering it from a red CI run.

## Completion Workflow

- After completing any change in this repo, run the relevant verification
  commands before reporting completion.
- If plugin-visible files change, including plugin skills, commands,
  `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`,
  `.agents/plugins/marketplace.json`, or `.claude-plugin/marketplace.json`,
  bump the aligned plugin version in `package.json`, Codex marketplace, Codex
  plugin, Claude marketplace, and Claude plugin manifests before commit and
  before push so installed caches take a fresh snapshot.
- Commit finished work on a feature branch when a commit is requested or
  appropriate for review.
- Do not push directly to protected or shared branches. Publish a branch and
  open or prepare a pull request when maintainers ask for one.
