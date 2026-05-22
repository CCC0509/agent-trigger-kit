# Scratch Namespace Pre-Merge Controls Design

**Goal:** Turn the scratch namespace policy from mostly post-merge detection
into an earlier, review-visible control without breaking branch-local scratch
spec and plan review.

**Status:** Design spec. This file has graduated from the branch-local scratch
namespace into `docs/designs/` as the durable record for the implemented PR
advisory control.

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
guidance. The remaining gap is therefore not "no human review aid exists"; it
is that human review aids are not enough by themselves and there is no PR-stage
automated advisory or ready-state blocker.

## Current Controls

### Implemented

- `.gitignore` ignores `docs/superpowers/`, so ordinary `git add .` does not
  stage scratch specs or plans.
- `scripts/check-scratch-namespace.mjs` runs
  `git ls-files docs/superpowers/` and fails when tracked scratch files exist.
- `npm run check:scratch-namespace` exposes that check.
- `.github/workflows/ci.yml` runs the scratch namespace job only on push to
  `main`.
- `.github/PULL_REQUEST_TEMPLATE.md` includes a checklist item requiring
  tracked scratch files to be relocated or dropped before merge.
- `CONTRIBUTING.md` documents branch-local scratch specs and plans.

### Gap

There is no automated pull-request signal before merge. A branch can carry
tracked scratch files for review, keep them until the final commit, and still
look green in required PR checks. The push-to-`main` gate then catches the
problem only after the merge has landed.

## Root Cause

The failed step was merge preparation for `docs-document-header-checks-plan`.
That branch did some relocate-or-drop work, but left one non-durable execution
plan tracked under `docs/superpowers/plans/`.

For the ordinary merge that produced `1c6b40c`, checking the branch tip before
merge would have caught the issue. The merge result was not surprising: the
branch tip contained the tracked plan, so the merge result contained it too.

The stronger generalized root cause is absence of a pre-integration ready-state
control. The policy depends on a state transition:

1. During review, tracked scratch files are allowed when force-added
   intentionally.
2. Before merge, every tracked scratch file must be relocated or dropped.
3. On `main`, tracked scratch files are forbidden.

Automation currently enforces step 3 after integration. It does not help
enforce step 2 before integration.

## Design Principles

- Keep branch-local scratch review valid. A generic required `pull_request`
  blocker against PR heads would contradict the policy.
- Surface risk early. If a PR tracks scratch files, reviewers should see that
  in the Checks UI and ideally on the affected files.
- Separate advisory from blocking. Advisory checks are useful during review;
  blocking checks need an explicit ready signal such as a label or merge queue.
- Use one source of truth. The same script should power advisory, ready-state,
  and push-to-`main` checks so messages and path handling do not drift.
- Avoid redundant commands. `npm run check:scratch-namespace` already wraps
  `git ls-files docs/superpowers/`; running both at the same point is not two
  different checks.

## Proposed Controls

### 1. Advisory PR Check

Add a PR-scoped advisory job that reports tracked scratch files without blocking
ordinary review.

Preferred implementation:

- Extend `scripts/check-scratch-namespace.mjs` with an advisory or annotation
  mode, for example `--advisory` or `--github-warning`.
- In advisory mode, the script should:
  - list the same tracked files as the strict mode,
  - emit one GitHub annotation per file:
    `::warning file=<path>::Tracked scratch namespace file must be relocated or dropped before merge`,
  - exit `0` so the job is informational.
- Add a workflow job on `pull_request` that runs the advisory mode.
- Keep the existing push-to-`main` strict job unchanged.

Alternative implementation:

- Run the existing strict command in a PR job with `continue-on-error: true`.
- This is less precise because the warning can be buried in logs and the job
  state is easier to misread.

The advisory job is the first implementation priority because it is cheap,
matches the policy design, and adds signal exactly to the risky subset of PRs:
branches that intentionally force-add scratch docs.

### 2. Merge-Ready Blocking Check

Add a ready-state blocker that only fails when the branch is declared ready to
merge.

Lightweight option:

- Use a label such as `merge-ready`.
- Add a PR job that always runs, but only performs strict scratch validation
  when the label is present.
- When the label is absent, the job exits `0` and says the branch is still in
  review mode.
- When the label is present, the job runs `npm run check:scratch-namespace` and
  fails on tracked scratch files.

Limitations:

- The label must become part of the team's merge ritual, or branch protection
  must require the ready-state job plus a separate rule that maintainers use the
  label before merging.
- GitHub required-check behavior with skipped or conditional jobs needs to be
  verified in a real PR before relying on it as the only blocker.

This option is a practical middle step before a merge queue. It gives the tree
an explicit "ready" signal without requiring every PR to be immediately free of
scratch review artifacts.

### 3. Merge Queue Candidate Check

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

It should remain advisory or ready-gated for ordinary `pull_request` heads.

This is the structurally strongest preventive control because entering the
queue is the explicit ready signal and the checked tree is the integration
candidate. Its cost is workflow and culture: maintainers must use the queue
instead of direct merge.

### 4. Optional Local Hooks

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

1. Extend `scripts/check-scratch-namespace.mjs` with advisory annotation output.
2. Add tests covering strict failure, advisory success-with-warning output, and
   one annotation per tracked file.
3. Add an advisory PR job to `.github/workflows/ci.yml`.
4. Update `tests/open-source-config.test.mjs` to lock the advisory job shape.
5. Document the advisory signal in `CONTRIBUTING.md` and the PR template if the
   existing wording is not explicit enough.
6. Consider a second implementation step for a `merge-ready` label-gated
   blocking job.
7. Defer `merge_group` support until the team decides to use merge queue.

## Acceptance Criteria

- Ordinary PRs with no tracked `docs/superpowers/` files stay quiet.
- PRs with force-added scratch files produce visible GitHub warning annotations
  naming each tracked file.
- The advisory PR job does not block review.
- Pushes to `main` still run the strict check and fail when tracked scratch
  files exist.
- Any future ready-state blocker has an explicit ready signal and does not
  reject ordinary review branches solely for carrying scratch docs.
- The strict script remains the canonical implementation of the file detection
  logic.

## Out Of Scope

- Making `npm run validate` include the scratch namespace blocker. That would
  reintroduce the generic PR-head conflict the policy explicitly avoids.
- Requiring merge queue immediately.
- Automatically deleting scratch files.
- Moving all branch-local specs to `docs/designs/` by default. Relocate versus
  drop remains a branch-owner decision.
