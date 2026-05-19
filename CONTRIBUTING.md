# Contributing

Thanks for helping improve Agent Trigger Kit. This project is still early, so
small, focused pull requests are the easiest to review and merge.

## Development Setup

Use Node.js 20 or newer.

```bash
git clone https://github.com/CCC0509/agent-trigger-kit.git
cd agent-trigger-kit
npm test
npm run validate
```

There are no runtime npm dependencies today. The scripts use Node's standard
library and the built-in `node --test` runner.

## Branches And Pull Requests

- Create a feature branch from the latest `main`.
- Keep unrelated cleanups out of the same pull request.
- Include tests for script behavior changes.
- Update `README.md` or `CHANGELOG.md` when user-facing behavior changes.
- Do not push directly to protected or shared branches.

Before opening a pull request, run:

```bash
npm test
npm run validate
```

If your change affects packaging or the CLI bin, also run:

```bash
npm exec --cache /private/tmp/agent-trigger-kit-npm-cache --yes --package . -- agent-trigger-kit --help
npm pack --cache /private/tmp/agent-trigger-kit-npm-cache --dry-run --json
```

## Code Style

- Keep scripts small and focused.
- Prefer existing script patterns over introducing new abstractions.
- Keep generated trigger surfaces thin; long operating rules belong in
  canonical playbooks.
- Use structured JSON parsing/writing for manifests.
- Keep examples copy-pasteable.

## Version And Release Notes

For now, releases keep these versions aligned:

- `package.json`
- `.agents/plugins/marketplace.json`
- `plugins/agent-trigger-kit/.codex-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `plugins/agent-trigger-kit/.claude-plugin/plugin.json`

README-only changes may leave versions unchanged. Script behavior, plugin
manifest, skill, or command changes should update `CHANGELOG.md` when they are
user-visible.

## Reporting Problems

Use GitHub issues for bugs, feature requests, documentation problems, and
questions. Please include the commands you ran, the expected behavior, the
actual output, and your OS/tool versions when relevant.
