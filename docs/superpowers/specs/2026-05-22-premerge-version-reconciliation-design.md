# Pre-Merge Version Reconciliation Design

**Goal:** Add a local source-repo pre-merge guard that catches stale-base
version and changelog mistakes before `agent-trigger-kit` branches land on
`main`.

**Status:** Design spec. This is a branch-local scratch artifact under
`docs/superpowers/specs/`; before merge it must either graduate to
`docs/designs/` or be dropped.

## Problem

The `spec/scratch-namespace-premerge-controls` merge exposed a gap between the
existing point-in-time version checks and final branch reconciliation.

The feature branch was internally consistent at `0.1.11`, but `origin/main`
had already moved to `0.1.12`. A direct merge without rechecking the latest
base could have kept a stale `0.1.11` changelog entry or otherwise confused the
release story. Existing checks already verify that source manifests agree with
each other, but they do not answer whether the branch has been reconciled with
the target base and whether the changelog head matches the aligned source
version.

## Verified Current Behavior

`node scripts/check-plugin-version.mjs --surface source --json agent-trigger-kit`
still performs source manifest consistency checking. It reports the five source
versions and returns `versionMismatch: false` when all source surfaces are
aligned.

`npm run validate -- --require-version-bump --base origin/main` does not apply
to this source repository today. It fails before any source-side bump analysis
with:

```text
.agent-trigger-kit/generated.json: required by --require-version-bump to identify the plugin
```

That validator mode remains the consumer/generated trigger-layer bump gate.
The new pre-merge guard is source-repo-only and will not provide a consumer
wrapper alias.

## Scope

In scope:

- A source-repo-only `ops:premerge-version-check` command.
- Required `--base <ref-or-sha>` with no default.
- Composition of the existing source version checker instead of reimplementing
  five-manifest consistency.
- Source-side base reconciliation, changelog head alignment, and source-visible
  version bump checks.
- A JSON output mode for future CI advisory integration.
- An opt-in hook installer that runs the same guard before pushes to
  main-bound work.
- CONTRIBUTING guidance for local pre-merge reconciliation.

Out of scope:

- Consumer/generated trigger-layer premerge wrapper behavior. Consumers should
  keep running `agent-trigger-kit validate --require-version-bump --base <ref>`.
- Automatic changelog edits or automatic conflict resolution.
- A blocking CI gate. Future PR advisory work can reuse the same script.
- Changelog patch continuity enforcement. Skipped or yanked patch versions are
  a release convention question, not a pre-merge invariant.

## Release Policy Decisions

`CHANGELOG.md` does not use an `Unreleased` staging section. The pre-merge
guard will treat `## Unreleased` as an error, not as a heading to skip. The
first second-level heading must be a clean SemVer release heading in the form
`## x.y.z`, and that version must equal the aligned source version returned by
`check-plugin-version.mjs`.

`scripts/bump-plugin-version.mjs` will not grow a changelog fail-fast check in
this first implementation. That is a follow-up hardening option: after bumping
versions, it could warn or refuse when the changelog head is not the requested
new version. The pre-merge guard is the enforcement point for v1.

The implementation PR for this design will touch source-visible files such as
`scripts/**`, `package.json`, and plugin guidance. It must therefore bump the
aligned source version and add a matching changelog head entry before merge.
The implementation order should be:

1. bump the aligned source version, for example to `0.1.13`;
2. add a matching `## 0.1.13` changelog head entry;
3. land the pre-merge guard implementation;
4. run `npm run ops:premerge-version-check -- --base origin/main` as the final
   acceptance check.

## Design Principles

- Compose existing checks where they already own behavior.
- Keep source-repo and consumer/generated definitions separate. They have
  different plugin-visible surfaces and should not share one path parser.
- Make stale-base failures obvious before semantic release decisions are made.
- Report every failed named check, but choose a deterministic exit reason.
- Prefer code-as-config for this single-plugin source repository over another
  JSON config file.
- Keep CI integration possible without requiring CI in v1.

## Phase 1: Git Base Refactor

Create `scripts/lib/git-base.mjs` and move the shared git helpers out of
`scripts/validate-trigger-layer.mjs` without changing behavior.

The module should own:

- `runGit({ root, args })`
- `showFile({ root, ref, path })`
- `mergeBase({ root, base, head })`
- `changedFiles({ root, base, head })`
- `isAncestor({ root, ancestor, descendant })`
- `shallowFetchHint(operation, details)`
- path normalization used for git diff output

`validate-trigger-layer.mjs --require-version-bump` should use this module but
keep its generated-manifest-specific plugin-visible logic unchanged.
`shallowFetchHint()` should keep returning the same string shape in this phase,
because the existing validator passes that value directly to `fail()`. Phase 2
may wrap git-base results in source-check-specific result objects, but Phase 1
must remain a pure refactor.

Review path:

1. Commit the pure refactor separately.
2. Run the existing test suite.
3. Confirm no behavior change in current `--require-version-bump` tests.

## Phase 2: Source Pre-Merge Guard

Add `scripts/premerge-version-check.mjs` and package script:

```json
"ops:premerge-version-check": "node scripts/premerge-version-check.mjs"
```

Arguments:

- `--base <ref-or-sha>`: required. There is no default. The error message
  should say: `--base is required; pass --base origin/main or the target merge base`.
- `--root <path>`: optional, default `process.cwd()`.
- `--plugin <name>`: optional, default `agent-trigger-kit`.
- `--json`: optional. Human output remains the default.

The command is source-repo-only. If it cannot find the source repository's
marketplace/manifests for the requested plugin, it should fail as
`source-version-consistency`; it should not switch into consumer mode.

### Named Checks

The wrapper runs four named checks.

1. `source-version-consistency`

   Spawn:

   ```text
   node scripts/check-plugin-version.mjs --root <root> --surface source --json <plugin>
   ```

   Parse JSON stdout. Non-zero exit, invalid JSON, missing `expectedVersion`,
   or `versionMismatch: true` fails this check. The wrapper does not duplicate
   source manifest consistency logic.

   The parent `--root <path>` must be forwarded to the child checker. The
   wrapper should spawn instead of import so it depends only on the existing
   command interface, not on private child-script internals. Because the child
   already supports `--json`, the implementation must verify that JSON mode
   writes only JSON to stdout; extra warnings would make wrapper parsing
   ambiguous.

2. `base-reconciliation`

   Use `git merge-base --is-ancestor <base> HEAD`. If it fails because the base
   ref is unknown or history is shallow, return the shared shallow/fetch-depth
   hint. This check catches branches that have not incorporated the intended
   target base.

3. `changelog-head-alignment`

   Read `CHANGELOG.md` at the working tree. Fail when:

   - the file is missing,
   - there is no `## ...` heading,
   - the first heading is `## Unreleased`,
   - the first heading is not clean SemVer `## x.y.z`,
   - the first heading does not equal `source-version-consistency.expectedVersion`.

4. `plugin-visible-version-bump`

   Compare source-visible file changes against the base. If no source-visible
   paths changed, pass without requiring a bump. If source-visible paths
   changed, compare the aligned plugin version at `<base>` with the current
   aligned source version and require `current > base`.

   The check reuses git-base utilities and the same version snapshot semantics
   as the existing validator, but it uses a source-repo-specific path list.

### Check Prerequisites

Each check reports exactly one of `passed`, `failed`, or `skipped`.

| Check                         | Prerequisites                                               | Skip Rule                                                    |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| `source-version-consistency`  | none                                                        | never skipped                                                |
| `base-reconciliation`         | none                                                        | never skipped                                                |
| `changelog-head-alignment`    | `source-version-consistency` passed and produced a version  | skipped when the source version is unavailable               |
| `plugin-visible-version-bump` | `source-version-consistency` and `base-reconciliation` pass | skipped when the source version or reconciled base is missing |

When an upstream prerequisite fails, dependent checks should be `skipped`, not
`failed`. The `reason` should name the failed prerequisite. `exitReason` still
uses the priority list below, so an upstream failure remains the selected exit
reason.

### Source-Visible Paths

Create `scripts/lib/source-plugin-visible.mjs` as code-as-config.

Initial source-visible path rules for `agent-trigger-kit`:

- `.agents/plugins/marketplace.json`
- `.claude-plugin/marketplace.json`
- `package.json`
- `package-lock.json`
- `plugins/agent-trigger-kit/**`
- `scripts/**`
- `templates/**`

These paths represent files that can affect installed plugin behavior, package
CLI behavior, generated trigger-layer output, or release metadata. README-only,
CONTRIBUTING-only, tests-only, and durable design-doc changes remain
non-source-visible unless this list is changed.

`package-lock.json` is intentionally strict. Some lockfile-only changes are
metadata churn or transitive patch updates that may not change runtime behavior,
but lockfile drift can change install behavior in CI and in fresh clones. The
guard chooses a conservative release signal for lockfile changes.

The source-visible list is intentionally separate from
`validate-trigger-layer.mjs` generated-manifest path logic. Consumer projects
derive plugin-visible paths from `.agent-trigger-kit/generated.json`; this
source repository uses fixed source surfaces.

### Exit Codes And Priority

The script should collect all check results, then choose the exit reason using
this priority:

1. `source-version-consistency`
2. `base-reconciliation`
3. `changelog-head-alignment`
4. `plugin-visible-version-bump`

Rationale: lower-level invariants make later checks less trustworthy. For
example, if source versions differ, the changelog expected version is not
well-defined.

Human output should print every failing check with its reason and details. The
process exits `0` only when every check passes. Any failing check exits `1`.
Argument misuse exits `2`.

### JSON Output

`--json` prints:

```json
{
  "checks": [
    {
      "name": "source-version-consistency",
      "status": "passed",
      "reason": "source versions are aligned",
      "details": {
        "expectedVersion": "0.1.12"
      }
    }
  ],
  "overallStatus": "passed",
  "exitReason": null
}
```

`status` is one of `passed`, `failed`, or `skipped`. A check may be skipped
only when an earlier prerequisite failed, such as skipping
`plugin-visible-version-bump` when the base ref is unavailable. Keeping the enum
explicit also gives future CI advisory behavior room to report graceful skips
for unavailable base history.

When multiple checks fail, JSON output still lists them all. `exitReason` is
the highest-priority failed check name.

Example with an upstream failure and dependent skips:

```json
{
  "checks": [
    {
      "name": "source-version-consistency",
      "status": "failed",
      "reason": "source versions differ",
      "details": {
        "sourceVersions": [
          { "label": "package.json", "version": "0.1.12" },
          { "label": "codex marketplace", "version": "0.1.13" }
        ]
      }
    },
    {
      "name": "base-reconciliation",
      "status": "failed",
      "reason": "base is not an ancestor of HEAD",
      "details": {
        "base": "origin/main"
      }
    },
    {
      "name": "changelog-head-alignment",
      "status": "skipped",
      "reason": "requires source-version-consistency",
      "details": {}
    },
    {
      "name": "plugin-visible-version-bump",
      "status": "skipped",
      "reason": "requires base-reconciliation",
      "details": {}
    }
  ],
  "overallStatus": "failed",
  "exitReason": "source-version-consistency"
}
```

## Hook Installer

Add `scripts/install-hooks.mjs`. It writes `.git/hooks/pre-push` for this local
checkout and marks it executable.

The hook command is intentionally simple:

```sh
npm run ops:premerge-version-check -- --base origin/main
```

The generated hook should include a comment:

```text
This hook protects main-bound Agent Trigger Kit work. Disable or edit it when
pushing to another integration target.
```

The hook does not parse pre-push stdin to infer the actual target branch in v1.
That would be more correct, but it adds complexity before the basic guard has
proved useful.

Document the escape hatch explicitly: use `git push --no-verify` when pushing
to a non-main integration target or a sandbox remote. A v2 follow-up can parse
pre-push stdin and run only when the remote ref is main-bound, but v1 keeps the
hook simple.

## CONTRIBUTING Updates

Document the local merge workflow:

1. `git fetch origin`
2. merge or rebase the target base into the branch
3. run `npm run ops:premerge-version-check -- --base origin/main`
4. if source-visible files changed, bump the aligned source version above the
   base version
5. keep `CHANGELOG.md` head equal to the aligned source version

Also document the source-visible path list and the no-`Unreleased` policy.
The hook section should mention `scripts/install-hooks.mjs`, the main-bound
assumption, and the `git push --no-verify` escape hatch.

## Future CI Advisory

Do not add CI in v1.

When CI advisory is added later:

- Use `github.event.pull_request.base.sha`, not `origin/main`, for PR checks.
- Configure `actions/checkout` with enough history for merge-base and diff
  operations. `fetch-depth: 0` is the simplest correct setting.
- Treat unavailable base history as a graceful advisory result with explicit
  details rather than a noisy generic failure.
- Reuse the `--json` schema instead of changing the script interface.

## Known Limitation

The guard is structural, not semantic. It can catch a mismatched changelog head,
but it cannot prove that a new changelog bullet was placed in the correct
section.

For example, if a branch adds content under an existing `## 0.1.11` heading and
`main` adds a newer `## 0.1.12` heading above it, a textual-clean merge can
produce a changelog whose head is `0.1.12` while the new feature note remains
misfiled under `0.1.11`. The pre-merge guard will pass the head-alignment
check. Human review still owns semantic placement of release notes.

## Test Matrix

### Source Version Consistency

- Pass: five source versions aligned and `check-plugin-version` returns valid
  JSON with `versionMismatch: false`.
- Fail: one source manifest version differs; wrapper reports
  `source-version-consistency`.
- Fail: child checker exits non-zero.

### Base Reconciliation

- Pass: `base` is an ancestor of `HEAD`.
- Fail: `base` is a sibling commit not contained in `HEAD`.
- Fail: `base` is unknown or unavailable; output includes fetch-depth or
  unshallow guidance.
- Fail: missing `--base` exits `2` with the required-argument message.
- Fail: `base` is unknown; `base-reconciliation` fails and
  `plugin-visible-version-bump` is skipped.

### Changelog Head Alignment

- Pass: `CHANGELOG.md` first heading is `## <expectedVersion>`.
- Fail: `CHANGELOG.md` is missing.
- Fail: `CHANGELOG.md` has no second-level heading.
- Fail: first heading is `## Unreleased`.
- Fail: first heading is non-SemVer, for example `## Next`.
- Fail: first heading is clean SemVer but differs from the expected version.

### Plugin-Visible Version Bump

- Pass: no source-visible paths changed relative to base.
- Pass: source-visible paths changed and current aligned version is greater
  than base aligned version.
- Fail: source-visible paths changed and current aligned version equals base.
- Fail: source-visible paths changed and current aligned version is lower than
  base.
- Pass: README-only, CONTRIBUTING-only, tests-only, or durable design-doc
  changes do not require a version bump.

### JSON And Priority

- Pass: `--json` contains `checks`, `overallStatus`, and `exitReason`.
- Fail: when source consistency and changelog alignment both fail,
  `exitReason` is `source-version-consistency`.
- Fail: when base reconciliation and plugin-visible bump both fail,
  `exitReason` is `base-reconciliation`.
- Pass: upstream failed checks cause dependent checks to appear as `skipped`
  in JSON, and `exitReason` remains the upstream failed check.

### Hook Installer

- Pass: `scripts/install-hooks.mjs` creates `.git/hooks/pre-push`.
- Pass: generated hook calls `npm run ops:premerge-version-check -- --base origin/main`.
- Pass: generated hook contains the main-bound work comment.

## Verification Commands

Phase 1:

```sh
npm test
npm run lint
npm run format:check
npm run validate
```

Phase 2:

```sh
npm test
npm run lint
npm run format:check
npm run validate
npm run ops:plugin-version-check -- --surface source agent-trigger-kit
npm run ops:premerge-version-check -- --base origin/main
npm run check:scratch-namespace -- --advisory
```

The strict scratch namespace check is expected to fail while this spec remains
tracked under `docs/superpowers/specs/`. Before merging, the spec must be
graduated to `docs/designs/` or dropped.
