# Superpowers Scratch Namespace Policy Design

**Goal:** Make `docs/superpowers/` a scratch namespace that can support branch-local spec and plan review, while graduating durable records to `docs/designs/` and keeping work-in-progress planning artifacts out of the final `main` tree.

**Status:** Design spec. No implementation files have been changed by this spec. This policy spec itself has graduated out of the scratch namespace and lives in `docs/designs/`.

## Problem

The repository currently treats Superpowers specs and plans as normal project
documentation. As of `main` commit `9708384` (`docs: add provenance-aware
plugin sync plan and spec`), `main` tracks five files under
`docs/superpowers/`, and that commit added a spec and plan directly to the
scratch namespace. That history means the desired policy is a behavior change,
not a simple configuration tweak.

Specs and plans are useful during design and implementation review, but they
are not always durable project documentation. Leaving them in `main` has two
costs:

- The main tree accumulates transient planning artifacts.
- Agents and maintainers cannot tell whether a file under `docs/superpowers/`
  is canonical documentation or temporary working state.

The repository needs a lifecycle that keeps design work reviewable while making
the final documentation surface explicit.

## Non-Negotiable Invariant

`docs/superpowers/` is a scratch namespace and must be empty in the final `main`
tree.

The enforceable condition is:

```bash
git ls-files docs/superpowers/
```

On `main`, that command must produce no output.

This invariant intentionally checks the tree state rather than trying to infer
whether a file was committed directly on `main`, added through a merge commit,
or preserved through a squash merge. The only state that matters is whether the
scratch namespace survives into `main`.

## Current-State Cleanup

Adding a `.gitignore` rule does not affect the five files already tracked under
`docs/superpowers/` as of `9708384`. Git ignore rules only apply to untracked
files.

Before the policy can be enforced, the first implementation change must triage
the existing tracked files:

- Files with durable value are relocated to `docs/designs/`.
- Files that are only working artifacts are removed from the tracked tree with
  `git rm` when they should be deleted, or `git rm --cached` when the branch
  should stop tracking them while preserving the local working copy.

This policy spec is durable content and must not be merged from
`docs/superpowers/`. It belongs in `docs/designs/`, alongside the implementation
changes that add ignore rules, documentation, and enforcement.

After cleanup, `git ls-files docs/superpowers/` must be empty.

## Canonical Design Namespace

Until the project defines a richer documentation taxonomy, durable design
records graduate to `docs/designs/`.

Use `docs/designs/` for accepted or review-worthy design records that should
remain visible after merge, including policy specs and implementation design
notes. Future work may introduce `docs/decisions/` for accepted architecture
decision records, but contributors do not need to wait for that taxonomy before
relocating durable Superpowers artifacts.

## Repository-Wide Ignore Policy

The repository should ignore `docs/superpowers/` in the tracked `.gitignore`
for every branch.

The ignore rule is not branch-specific. There is no supported model where
`main` ignores the namespace while feature branches do not. A branch-dependent
`.gitignore` would make normal merges fragile and would not provide a reliable
team policy.

The ignore rule is a convenience layer only. It prevents accidental `git add .`
from staging scratch specs and plans. It is not the load-bearing control.

Because the final `main` tree must keep `docs/superpowers/` empty, the scratch
namespace must not contain a tracked README or explainer file. Contributor
documentation for the scratch namespace belongs outside that namespace, such as
in `CONTRIBUTING.md`.

When a spec or plan needs to be reviewed in a branch or pull request, authors
use explicit opt-in staging:

```bash
git add -f docs/superpowers/specs/<date>-<topic>-design.md
git add -f docs/superpowers/plans/<date>-<topic>.md
```

That forced add is intentional friction. It makes branch-local review possible
without weakening the final `main` invariant.

## Branch Workflow

Any work that needs a Superpowers spec or plan starts from a dedicated branch
before those files are created or staged.

Recommended flow:

```bash
git switch main
git pull --ff-only
git switch -c feat/<topic>
```

If the team does not use slash-style branch namespaces, use a plain descriptive
branch name instead.

Branch-local scratch files may be created under:

- `docs/superpowers/specs/`
- `docs/superpowers/plans/`

Those files remain ignored by default. A branch author may force-add them when
they are useful review material.

## Merge Preparation

Before a branch is merged, the branch owner must choose one of two outcomes for
each scratch spec or plan:

- **Relocate:** Move durable content into a canonical documentation namespace.
  The relocated document becomes project documentation and is no longer under
  `docs/superpowers/`. Until a richer taxonomy exists, the destination is
  `docs/designs/`.
- **Drop:** Remove the scratch file from the branch's final diff. The design
  discussion remains available through branch or pull request history, but the
  planning artifact does not become part of the main tree.

This decision is owned by the branch author and reviewed by maintainers. It
should be explicit in the pull request checklist so the choice is visible during
review instead of depending on memory.

For squash merges, "drop" means the file is actually removed from the branch so
the net squash diff contains no tracked `docs/superpowers/` entries. It is not
enough to rely on the merge mechanism to omit a previously force-added scratch
file.

## Pull Request Checklist

Add a required checklist item to the contributor workflow:

```markdown
- [ ] `docs/superpowers/` contains no files in the final merge diff. Scratch
      specs/plans were either relocated to canonical docs or dropped.
```

The checklist is a human review aid. It does not replace automated validation.

## Enforcement

The load-bearing enforcement is an automated check that fails if tracked files
exist under `docs/superpowers/`.

The check can be implemented as a small script or direct CI command:

```bash
test -z "$(git ls-files docs/superpowers/)"
```

### Enforcement Scope

The blocking check must be scoped to final integration state, not every
feature-branch or draft pull request run.

Branch-local review may intentionally force-add scratch specs and plans. A
required check that runs on every `pull_request` head would reject that valid
review workflow. The check should therefore run in one of these scopes:

- On `push` to `main`, as a protected-main health gate and release blocker.
- On a merge-queue or equivalent candidate merge result after branch owners
  have completed merge preparation.
- As an advisory, non-blocking pull request check before merge preparation.

If the project later wants pre-merge blocking enforcement, it must use the
candidate final tree after relocate-or-drop, not the ordinary feature branch
state while scratch review files are still present.

If the command fails, the error message should explain the lifecycle:

- `docs/superpowers/` is scratch space.
- Durable specs and plans must be relocated to canonical docs before merge.
- Non-durable scratch artifacts must be removed from the tracked tree.
- `.gitignore` does not untrack existing files; use `git rm` or `git mv` as
  appropriate.

In this repository, `.github/workflows/ci.yml` currently runs on both
`pull_request` and `push` to `main`. The implementation must not add a required
scratch-namespace blocker to the generic pull request path unless it is scoped
to a merge-ready candidate tree. Otherwise the check would contradict the
branch-local review model.

The concrete gate belongs in `.github/workflows/ci.yml` as a dedicated
scratch-namespace job or step with an explicit event/ref condition. It should
not be added unconditionally to `npm run validate`, because that command runs in
the existing pull request CI path.

## Atomic Rollout

The first implementation PR must land the cleanup, ignore rule, enforcement
mechanism, and contributor documentation together.

That PR must leave no intermediate merged state where:

- `docs/superpowers/` still has tracked files and enforcement is already active.
- `.gitignore` hides new scratch files but existing tracked scratch files remain
  untreated.
- The policy spec remains under `docs/superpowers/` instead of `docs/designs/`.

If CI or branch protection validates every commit independently, the first
implementation PR should make the rollout in a single commit. Otherwise, the
final PR state must be atomic even if the branch contains intermediate working
commits.

## Documentation

Update contributor-facing documentation to describe:

- `docs/superpowers/` is scratch space, not canonical project docs.
- The namespace is ignored repository-wide.
- `git add -f` is the explicit opt-in for branch-local review.
- Branch owners must relocate durable scratch files to `docs/designs/` or drop
  non-durable scratch files before merge.
- The scratch namespace must not contain a tracked README on `main`; explain the
  namespace from outside it.
- The final `main` tree must satisfy
  `git ls-files docs/superpowers/` producing no output.

The docs should avoid saying "main ignores `docs/superpowers/`" because that is
technically misleading. The correct framing is "the repository ignores this
scratch namespace everywhere, and automation enforces that it is empty in
`main`."

## Tests And Verification

Implementation should include verification for:

- Existing tracked `docs/superpowers/` files are removed or relocated.
- `.gitignore` includes `docs/superpowers/`.
- The enforcement command fails when a tracked scratch file exists.
- The enforcement command passes when the namespace contains only ignored
  untracked files.
- The enforcement gate is not a required generic `pull_request` check against
  ordinary feature-branch state.
- `npm run validate` does not include an unscoped scratch-namespace blocker.
- Contributor documentation includes the relocate-or-drop merge preparation
  rule.

Manual verification should include:

```bash
git ls-files docs/superpowers/
```

The expected output after implementation is empty.

## Out Of Scope

This policy does not define the final long-term taxonomy for durable design
records beyond the interim rule that graduated Superpowers specs and plans go
to `docs/designs/`.

This policy does not require every implementation branch to publish scratch
specs or plans for review. If a spec or plan is purely personal working state,
it can remain untracked for the whole branch. Durable documentation should be
written directly in the canonical docs namespace.

This policy does not rewrite Git history. Previously committed scratch files
remain in history, but they must not remain in the final `main` tree after the
cleanup change lands.

## Deferred Work

A future policy can define the canonical durable-design namespace in more
detail, including naming, required metadata, and whether accepted architecture
decision records should live in a separate `docs/decisions/` namespace.
