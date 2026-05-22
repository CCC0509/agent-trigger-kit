# Scratch Namespace Pre-Merge Controls Design

**Goal:** Turn the scratch namespace policy from mostly post-merge detection
into an earlier, review-visible control without breaking branch-local scratch
spec and plan review.

**Status:** Implemented design note. This file has graduated from the
branch-local scratch namespace into `docs/designs/` as the durable record for
the scratch namespace PR gate and related advisory controls.

## Review Synthesis

The scratch namespace policy was conceptually correct. The incident exposed a
control gap between branch review and final integration:

- The existing push-to-`main` `scratch-namespace` CI job is a detective
  control. It can report a bad `main` tree after integration, but it does not
  prevent the merge that introduced the tracked scratch file.
- The missing preventive control was a merge-ready check that runs before
  integration, or an advisory PR signal that makes the tracked scratch files
  visible while review is still happening.
- The exact incident did not require a synthetic merge-candidate tree to catch
  it. The source branch tip already tracked
  `docs/superpowers/plans/2026-05-21-document-header-checks.md`.
- A candidate-tree check is still useful for squash merges, merge queues, or
  any flow where the integration mechanism can produce a different final tree
  from the branch tip.

Current repo verification also found one correction to the review note: current
`main` and `origin/main` already have `.github/PULL_REQUEST_TEMPLATE.md` and
`CONTRIBUTING.md`, including scratch namespace checklist and contributor
guidance. The remaining gap was therefore not "no human review aid exists"; it
was that human review aids were not enough by themselves and the blocking check
did not run at PR validation time.

## Current Controls

### Implemented

- `.gitignore` ignores `docs/superpowers/`, so ordinary `git add .` does not
  stage scratch specs or plans.
- `scripts/check-scratch-namespace.mjs` runs
  `git ls-files docs/superpowers/` and fails when tracked scratch files exist.
- `npm run check:scratch-namespace` exposes that check.
- `.github/workflows/ci.yml` runs `npm run check:scratch-namespace` as an
  independent step in the `validate` job, so PRs fail before merge when tracked
  scratch files remain.
- `.github/workflows/ci.yml` keeps a draft-PR advisory job that emits warning
  annotations for tracked scratch files.
- `.github/workflows/ci.yml` keeps the push-to-`main` strict job as a
  belt-and-suspenders guard for protected history.
- `.github/PULL_REQUEST_TEMPLATE.md` includes a checklist item requiring
  tracked scratch files to be relocated or dropped before merge.
- `npm run preflight` mirrors the local quality gate, including scratch
  namespace validation.
- `scripts/install-hooks.mjs` installs an optional pre-push hook that runs the
  scratch namespace check before the pre-merge version check.
- `CONTRIBUTING.md` documents branch-local scratch specs and plans plus the
  local preflight and hook commands.

### Gap

Resolved for ordinary PR validation. A branch that carries tracked scratch
files now fails the `validate` job before it can merge through the normal PR
path. If the repository adopts merge queue, the strict check should also cover
`merge_group` candidate trees.

## Root Cause

The failed step was merge preparation for `docs-document-header-checks-plan`.
That branch did some relocate-or-drop work, but left one non-durable execution
plan tracked under `docs/superpowers/plans/`.

For the ordinary merge that produced `1c6b40c`, checking the branch tip before
merge would have caught the issue. The merge result was not surprising: the
branch tip contained the tracked plan, so the merge result contained it too.

The stronger generalized root cause was absence of a pre-integration
ready-state control. The policy depends on a state transition:

1. During review, tracked scratch files are allowed when force-added
   intentionally.
2. Before merge, every tracked scratch file must be relocated or dropped.
3. On `main`, tracked scratch files are forbidden.

Automation previously enforced step 3 after integration. The implemented fix
moves step 2 into PR validation while retaining the post-integration guard as a
backup.

## Design Principles

- Keep branch-local scratch review explicit. Force-added scratch docs may exist
  while a branch is being developed, but a PR that is intended to merge must
  pass the same scratch namespace invariant that `main` requires.
- Surface risk early. If a PR tracks scratch files, reviewers should see that
  in the Checks UI and ideally on the affected files.
- Separate advisory from blocking. Advisory checks are useful during draft
  review; blocking checks belong in the normal `validate` job so maintainers do
  not need a separate ritual to remember the invariant.
- Use one source of truth. The same script should power advisory, ready-state,
  and push-to-`main` checks so messages and path handling do not drift.
- Avoid redundant commands. `npm run check:scratch-namespace` already wraps
  `git ls-files docs/superpowers/`; running both at the same point is not two
  different checks.

## Implemented Controls

### 1. PR Validate Gate

The `validate` job runs this step as a hard gate:

```yaml
- name: Check scratch namespace
  run: npm run check:scratch-namespace
```

This keeps the CI UI split into independent lint, format, scratch, test, and
trigger-layer validation steps. It intentionally does not collapse CI into a
single `npm run preflight` step, because separate steps provide clearer
annotations and timing.

### 2. Local Preflight

`npm run preflight` exists for local use:

```bash
npm run lint && npm run format:check && npm test && npm run validate && npm run check:scratch-namespace
```

It mirrors the expected local pre-PR quality gate, but CI continues to run the
commands as separate workflow steps.

### 3. Draft PR Advisory

Keep a PR-scoped advisory job that reports tracked scratch files without adding
another required check for non-draft PRs. It is scoped to draft PRs, where the
extra warning annotations are useful while review material is still in flux.

Implementation:

- Extend `scripts/check-scratch-namespace.mjs` with an advisory or annotation
  mode, for example `--advisory` or `--github-warning`.
- In advisory mode, the script should:
  - list the same tracked files as the strict mode,
  - emit one GitHub annotation per file:
    `::warning file=<path>::Tracked scratch namespace file must be relocated or dropped before merge`,
  - exit `0` so the job is informational.
- Run the advisory job only when
  `github.event_name == 'pull_request' && github.event.pull_request.draft == true`.

### 4. Merge Queue Candidate Check

When the repository adopts GitHub merge queue, add `merge_group` coverage for
the strict scratch namespace check.

The workflow should run the strict command on the merge-group candidate tree:

```yaml
on:
  pull_request:
  push:
    branches: [main]
  merge_group:
```

The scratch namespace job should remain strict for:

- `push` to `main`
- `merge_group`

The existing `validate` job already handles ordinary `pull_request` heads.

This is the structurally strongest preventive control because entering the
queue is the explicit ready signal and the checked tree is the integration
candidate. Its cost is workflow and culture: maintainers must use the queue
instead of direct merge.

### 5. Optional Local Hooks

Local hooks can reduce misses but must not be the main control.

Useful hooks:

- `pre-push`: run `npm run check:scratch-namespace` when pushing `main` or a
  merge-ready branch.
- `pre-merge-commit`: run the same command after a local merge commit is
  created.

Limitations:

- Hooks are local only.
- They can be bypassed with `--no-verify`.
- They do not run for GitHub UI merges.

If implemented, hooks should be documented as developer convenience layered
under CI, not as the policy's enforcement boundary.

## Drop Confirmation For The Cleanup Commit

The cleanup commit that removed
`docs/superpowers/plans/2026-05-21-document-header-checks.md` is a drop, not a
relocation. That is acceptable if durable content from the document-header work
is already represented outside the scratch namespace.

Current evidence indicates durable content exists in:

- `docs/designs/2026-05-21-document-header-checks-design.md`
- `README.md`
- `CHANGELOG.md`
- validator and init tests under `tests/trigger-layer-scripts.test.mjs`
- plugin skill and command guidance

The dropped file was an execution plan with task checklists and intermediate
test snippets. Any implementation branch that removes a scratch plan should do
the same quick check before final cleanup: durable design and user-facing
documentation must exist elsewhere, or the content should be relocated instead
of dropped.

## Implementation Outline

1. Add `npm run check:scratch-namespace` to the `validate` job as a separate
   workflow step.
2. Add `npm run preflight` for local use.
3. Add `npm run preflight` to the PR template verification checklist and
   contributor docs.
4. Add `npm run check:scratch-namespace` to the optional pre-push hook.
5. Scope the advisory job to draft PRs and document the push-to-`main` strict
   job as a belt-and-suspenders guard.
6. Update tests to parse `.github/workflows/ci.yml` as YAML and lock the
   workflow semantics without relying on brittle raw text matches.
7. Defer `merge_group` support until the team decides to use merge queue.

## Acceptance Criteria

- Ordinary PRs with no tracked `docs/superpowers/` files pass the scratch
  namespace step in the `validate` job.
- PRs with force-added scratch files fail the `validate` job before merge.
- Draft PRs with force-added scratch files also produce visible warning
  annotations naming each tracked file.
- Pushes to `main` still run the strict check and fail when tracked scratch
  files exist.
- The strict script remains the canonical implementation of the file detection
  logic.

## Out Of Scope

- Making `npm run validate` include the scratch namespace blocker. That would
  reintroduce the generic PR-head conflict the policy explicitly avoids.
- Requiring merge queue immediately.
- Automatically deleting scratch files.
- Moving all branch-local specs to `docs/designs/` by default. Relocate versus
  drop remains a branch-owner decision.
