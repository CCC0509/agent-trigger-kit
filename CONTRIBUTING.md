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

CI pins Claude Code CLI to `@anthropic-ai/claude-code@2.1.116`. Bump that
version intentionally when validating against a newer Claude CLI release.

## Scratch Specs And Plans

`docs/superpowers/` is branch-local scratch space for Superpowers specs and
plans. It is ignored repository-wide so `git add .` does not accidentally stage
working design artifacts.

Create a feature branch before writing scratch specs or plans. If a scratch
document needs review in a pull request, stage it explicitly:

```bash
git add -f docs/superpowers/specs/<date>-<topic>-design.md
git add -f docs/superpowers/plans/<date>-<topic>.md
```

Pull requests run a non-blocking `Scratch Namespace Advisory` check. If tracked
scratch files are present, the check emits GitHub warning annotations on each
file so reviewers can see the risk while branch-local design review is still in
progress. This advisory does not block ordinary review.

Before merge, relocate durable scratch documents to `docs/designs/` or drop
non-durable scratch artifacts from the branch. `docs/superpowers/` must contain
no tracked files in the final `main` tree.

## Pre-Merge Version Reconciliation

Before merging an Agent Trigger Kit source branch to `main`, reconcile the
branch against the intended base and run the local source pre-merge guard:

```bash
git fetch origin
git merge origin/main
npm run ops:premerge-version-check -- --base origin/main
```

Pass the actual target base when the branch is not main-bound. The guard has no
default base on purpose; `--base origin/main` is a maintainer decision, not an
implicit assumption.

The guard composes `ops:plugin-version-check -- --surface source` for the five
aligned source versions, then verifies that the base is an ancestor of `HEAD`,
the `CHANGELOG.md` head matches the aligned source version, and source-visible
changes have bumped the aligned version above the base version.

`CHANGELOG.md` does not use `## Unreleased`; the first `## x.y.z` heading must
match the aligned source version.

Source-visible paths currently include:

- `.agents/plugins/marketplace.json`
- `.claude-plugin/marketplace.json`
- `package.json`
- `package-lock.json`
- `plugins/agent-trigger-kit/**`
- `scripts/**`
- `templates/**`

`package-lock.json` is intentionally included because lockfile drift can change
fresh install behavior in CI and clean clones.

To install an opt-in local pre-push hook for main-bound Agent Trigger Kit work:

```bash
node scripts/install-hooks.mjs
```

The hook always runs `npm run ops:premerge-version-check -- --base origin/main`.
When pushing to a sandbox remote or a non-main integration target, use
`git push --no-verify` or edit the hook for that local checkout.

## Code Style

- Keep scripts small and focused.
- Prefer existing script patterns over introducing new abstractions.
- Keep generated trigger surfaces thin; long operating rules belong in
  canonical playbooks.
- Use structured JSON parsing/writing for manifests.
- Keep examples copy-pasteable.

## SemVer Policy

Agent Trigger Kit is still in the `0.x` stage. Until `1.0.0`, minor releases
may include breaking script or trigger-layer changes, and patch releases should
stay limited to compatible fixes and documentation improvements.

After `1.0.0`:

- Major releases are for breaking CLI, script, generated layout, or plugin
  manifest behavior.
- Minor releases are for compatible new commands, skills, checks, and generated
  surfaces.
- Patch releases are for compatible bug fixes, documentation corrections, and
  metadata updates.

## Version And Release Notes

For now, releases keep these versions aligned:

- `package.json`
- `.agents/plugins/marketplace.json`
- `plugins/agent-trigger-kit/.codex-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `plugins/agent-trigger-kit/.claude-plugin/plugin.json`

Do not use `bump-plugin-version --surface` for normal releases. Surface-specific
bumps are an advanced repair path for one plugin surface and intentionally leave
the full release version set unaligned until a normal bump runs.

README-only changes may leave versions unchanged. Script behavior, plugin
manifest, skill, or command changes should update `CHANGELOG.md` when they are
user-visible.

## Reporting Problems

Use GitHub issues for bugs, feature requests, documentation problems, and
questions. Please include the commands you ran, the expected behavior, the
actual output, and your OS/tool versions when relevant.
