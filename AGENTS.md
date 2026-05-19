# Agent Trigger Kit Agent Instructions

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
