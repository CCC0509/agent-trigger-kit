# Superpowers Scratch Namespace Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce `docs/superpowers/` as branch-local scratch space while graduating durable design records to `docs/designs/`.

**Architecture:** Add a small Git-backed checker script for tracked scratch files, expose it through `package.json`, and run it only on `push` to `main` in CI so ordinary pull request branch heads can still contain force-added scratch review files. Clean up the existing tracked scratch namespace atomically, ignore future scratch files repository-wide, and document the relocate-or-drop merge rule in contributor and PR surfaces.

**Tech Stack:** Node.js ESM scripts, `node:test`, Git CLI pathspecs, GitHub Actions, Markdown docs, no new runtime dependencies.

---

## File Structure

- Create: `scripts/check-scratch-namespace.mjs`
  - CLI script that runs `git -C <root> ls-files docs/superpowers/`, prints a clear lifecycle error when tracked scratch files exist, and exits nonzero on violations.
- Create: `tests/scratch-namespace-policy.test.mjs`
  - Script-level tests using temporary Git repositories to prove untracked scratch files pass and tracked scratch files fail.
- Modify: `tests/open-source-config.test.mjs`
  - Config-level tests for the package script, ignore rule, PR checklist, contributor docs, and scoped CI gate.
- Modify: `package.json`
  - Adds `check:scratch-namespace` without wiring it into `validate`, preserving PR scratch review.
- Modify: `.github/workflows/ci.yml`
  - Adds a scratch namespace gate scoped to `push` events on `refs/heads/main`.
- Modify: `.github/PULL_REQUEST_TEMPLATE.md`
  - Adds an explicit relocate-or-drop checklist item.
- Modify: `CONTRIBUTING.md`
  - Documents the scratch namespace lifecycle, `git add -f` review opt-in, and merge preparation.
- Modify: `.gitignore`
  - Adds `docs/superpowers/` as a repository-wide ignore rule.
- Move: `docs/superpowers/specs/2026-05-20-playbook-first-guidance-design.md` -> `docs/designs/2026-05-20-playbook-first-guidance-design.md`
  - Graduates durable design content.
- Move: `docs/superpowers/specs/2026-05-20-provenance-aware-plugin-sync-design.md` -> `docs/designs/2026-05-20-provenance-aware-plugin-sync-design.md`
  - Graduates durable design content.
- Remove from tracked tree: `docs/superpowers/plans/2026-05-20-import-claude-skills.md`
  - Drops completed scratch plan artifact.
- Remove from tracked tree: `docs/superpowers/plans/2026-05-20-playbook-first-guidance.md`
  - Drops completed scratch plan artifact.
- Remove from tracked tree: `docs/superpowers/plans/2026-05-21-provenance-aware-plugin-sync.md`
  - Drops completed scratch plan artifact.
- Remove from tracked tree: `docs/superpowers/plans/2026-05-21-superpowers-scratch-namespace-policy.md`
  - Drops this branch-local implementation plan before the rollout branch merges.

## Execution Setup

Start execution from the reviewed planning branch, not directly from `main`.
The current branch must contain:

- `docs/designs/2026-05-21-superpowers-scratch-namespace-policy-design.md`
- `docs/superpowers/plans/2026-05-21-superpowers-scratch-namespace-policy.md`

Create the implementation branch from there:

```bash
git switch superpowers-scratch-namespace-policy
git switch -c feat/superpowers-scratch-namespace-policy
```

The rollout is atomic. Do not merge a branch state where `.gitignore`, cleanup, contributor docs, and CI enforcement are only partially present.
Tasks 1-4 should leave changes uncommitted while they build up the atomic rollout. Create the implementation commit only in Task 5.
The branch-local implementation plan is intentionally tracked for review on this planning branch, but Task 2 removes it from the final implementation tree.

---

### Task 1: Add Scratch Namespace Checker

**Files:**

- Create: `scripts/check-scratch-namespace.mjs`
- Create: `tests/scratch-namespace-policy.test.mjs`
- Modify: `tests/open-source-config.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing script tests**

Create `tests/scratch-namespace-policy.test.mjs` with this content:

```js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'agent-trigger-kit-scratch-test-'));
}

function runScript(root) {
  return spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts/check-scratch-namespace.mjs'), '--root', root],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
}

function runGit(root, args) {
  return spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });
}

function write(root, path, text) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${text.trimEnd()}\n`);
}

function initGitRepo(root) {
  const init = runGit(root, ['init']);
  assert.equal(init.status, 0, init.stderr || init.stdout);
}

test('scratch namespace check ignores untracked scratch files', () => {
  const root = makeRoot();
  initGitRepo(root);
  write(root, 'docs/superpowers/specs/draft-design.md', '# Draft');

  const result = runScript(root);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /scratch namespace check passed/i);
});

test('scratch namespace check fails and lists tracked scratch files', () => {
  const root = makeRoot();
  initGitRepo(root);
  write(root, 'docs/superpowers/specs/draft-design.md', '# Draft');
  const add = runGit(root, ['add', 'docs/superpowers/specs/draft-design.md']);
  assert.equal(add.status, 0, add.stderr || add.stdout);

  const result = runScript(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Tracked scratch namespace files are not allowed/);
  assert.match(result.stderr, /docs\/superpowers\/specs\/draft-design\.md/);
  assert.match(result.stderr, /relocate durable files to docs\/designs\//);
  assert.match(result.stderr, /git rm/);
});
```

Also update the existing `package exposes lint and format tooling with locked dev dependencies` test in `tests/open-source-config.test.mjs` so it asserts the new script exists and `validate` remains unchanged:

```js
assert.equal(pkg.scripts['check:scratch-namespace'], 'node scripts/check-scratch-namespace.mjs');
assert.equal(pkg.scripts.validate, 'node scripts/validate-trigger-layer.mjs --root .');
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
node --test tests/scratch-namespace-policy.test.mjs tests/open-source-config.test.mjs
```

Expected: FAIL because `scripts/check-scratch-namespace.mjs` does not exist and `package.json` does not yet expose `check:scratch-namespace`.

- [ ] **Step 3: Create the checker script**

Create `scripts/check-scratch-namespace.mjs` with this content:

```js
#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { normalize } from 'node:path';

import { parseArgs } from './lib/args.mjs';

const args = parseArgs(process.argv.slice(2));
const root = normalize(args.root || process.cwd());

const result = spawnSync('git', ['-C', root, 'ls-files', 'docs/superpowers/'], {
  encoding: 'utf8',
});

if (result.status !== 0) {
  const status = result.status ?? 1;
  const stderr = result.stderr?.trim() || result.error?.message || '';
  console.error(`scratch namespace check failed to run git ls-files in ${root}`);
  if (stderr) console.error(stderr);
  process.exit(status);
}

const trackedFiles = result.stdout.split(/\r?\n/).filter(Boolean);

if (trackedFiles.length === 0) {
  console.log('scratch namespace check passed: docs/superpowers/ has no tracked files');
  process.exit(0);
}

console.error('Tracked scratch namespace files are not allowed in the final main tree.');
console.error('');
console.error('docs/superpowers/ is branch-local scratch space.');
console.error(
  'Please relocate durable files to docs/designs/ or remove scratch artifacts with git rm.',
);
console.error('');
console.error('Tracked files:');
for (const file of trackedFiles) {
  console.error(`- ${file}`);
}

process.exit(1);
```

- [ ] **Step 4: Add the package script**

Modify `package.json` so the `scripts` block includes `check:scratch-namespace` and does not add it to `validate`:

```json
{
  "scripts": {
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "eslint .",
    "test": "node --test",
    "check:scratch-namespace": "node scripts/check-scratch-namespace.mjs",
    "ops:plugin-cache-sync": "node scripts/sync-codex-plugin-cache.mjs",
    "ops:local-agent-sync": "node scripts/update-local-agent-triggers.mjs",
    "ops:plugin-version-check": "node scripts/check-plugin-version.mjs",
    "validate": "node scripts/validate-trigger-layer.mjs --root ."
  }
}
```

Keep the rest of `package.json` unchanged.

- [ ] **Step 5: Run the focused tests to verify they pass**

Run:

```bash
node --test tests/scratch-namespace-policy.test.mjs tests/open-source-config.test.mjs
```

Expected: PASS for the scratch namespace script tests and the package script assertion.

---

### Task 2: Clean Tracked Scratch Files And Ignore Future Scratch

**Files:**

- Modify: `.gitignore`
- Move: `docs/superpowers/specs/2026-05-20-playbook-first-guidance-design.md`
- Move: `docs/superpowers/specs/2026-05-20-provenance-aware-plugin-sync-design.md`
- Remove: `docs/superpowers/plans/2026-05-20-import-claude-skills.md`
- Remove: `docs/superpowers/plans/2026-05-20-playbook-first-guidance.md`
- Remove: `docs/superpowers/plans/2026-05-21-provenance-aware-plugin-sync.md`

- [ ] **Step 1: Confirm the current tracked scratch files**

Run:

```bash
git ls-files docs/superpowers/
```

Expected output:

```text
docs/superpowers/plans/2026-05-20-import-claude-skills.md
docs/superpowers/plans/2026-05-20-playbook-first-guidance.md
docs/superpowers/plans/2026-05-21-provenance-aware-plugin-sync.md
docs/superpowers/plans/2026-05-21-superpowers-scratch-namespace-policy.md
docs/superpowers/specs/2026-05-20-playbook-first-guidance-design.md
docs/superpowers/specs/2026-05-20-provenance-aware-plugin-sync-design.md
```

- [ ] **Step 2: Relocate durable design specs**

Run:

```bash
mkdir -p docs/designs
git mv docs/superpowers/specs/2026-05-20-playbook-first-guidance-design.md docs/designs/2026-05-20-playbook-first-guidance-design.md
git mv docs/superpowers/specs/2026-05-20-provenance-aware-plugin-sync-design.md docs/designs/2026-05-20-provenance-aware-plugin-sync-design.md
```

Expected: both durable design records move to `docs/designs/`.

- [ ] **Step 3: Remove completed scratch plans from the tracked tree**

Run:

```bash
git rm docs/superpowers/plans/2026-05-20-import-claude-skills.md
git rm docs/superpowers/plans/2026-05-20-playbook-first-guidance.md
git rm docs/superpowers/plans/2026-05-21-provenance-aware-plugin-sync.md
git rm docs/superpowers/plans/2026-05-21-superpowers-scratch-namespace-policy.md
```

Expected: the completed plan artifacts and this branch-local implementation plan are staged for deletion.

- [ ] **Step 4: Add the scratch namespace ignore rule**

Modify `.gitignore` to include `docs/superpowers/`:

```gitignore
node_modules/
.DS_Store
*.log
tmp/
dist/
docs/superpowers/
```

- [ ] **Step 5: Verify the namespace is empty in the tracked tree**

Run:

```bash
git ls-files docs/superpowers/
```

Expected: no output.

- [ ] **Step 6: Verify the checker passes after cleanup**

Run:

```bash
npm run check:scratch-namespace
```

Expected: PASS with `scratch namespace check passed: docs/superpowers/ has no tracked files`.

---

### Task 3: Document The Contributor Workflow

**Files:**

- Modify: `CONTRIBUTING.md`
- Modify: `.github/PULL_REQUEST_TEMPLATE.md`
- Modify: `tests/open-source-config.test.mjs`

- [ ] **Step 1: Write failing documentation/config tests**

Append this test to `tests/open-source-config.test.mjs`:

```js
test('scratch namespace policy is documented and reviewable', () => {
  const gitignore = read('.gitignore');
  const contributing = read('CONTRIBUTING.md');
  const prTemplate = read('.github/PULL_REQUEST_TEMPLATE.md');

  assert.match(gitignore, /^docs\/superpowers\/$/m);
  assert.match(contributing, /docs\/superpowers\/.*scratch/i);
  assert.match(contributing, /git add -f docs\/superpowers\//);
  assert.match(contributing, /docs\/designs\//);
  assert.match(contributing, /relocate durable/i);
  assert.match(contributing, /drop\s+non-durable/i);
  assert.match(prTemplate, /docs\/superpowers\//);
  assert.match(prTemplate, /relocated to `docs\/designs\/` or dropped/);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
node --test tests/open-source-config.test.mjs
```

Expected: FAIL because `CONTRIBUTING.md` and the pull request template do not yet document the policy.

- [ ] **Step 3: Add the contributor documentation**

Add this section to `CONTRIBUTING.md` after `## Branches And Pull Requests`:

````markdown
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

Before merge, relocate durable scratch documents to `docs/designs/` or drop
non-durable scratch artifacts from the branch. `docs/superpowers/` must contain
no tracked files in the final `main` tree.
````

- [ ] **Step 4: Add the pull request checklist item**

Modify `.github/PULL_REQUEST_TEMPLATE.md` so the checklist includes this item:

```markdown
- [ ] `docs/superpowers/` contains no tracked files in the final merge diff; scratch specs/plans were relocated to `docs/designs/` or dropped.
```

Keep the existing checklist items.

- [ ] **Step 5: Run the focused documentation/config test**

Run:

```bash
node --test tests/open-source-config.test.mjs
```

Expected: PASS.

---

### Task 4: Add A Main-Scoped CI Gate

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `tests/open-source-config.test.mjs`

- [ ] **Step 1: Write the failing CI scope test**

Append this test to `tests/open-source-config.test.mjs`:

```js
test('scratch namespace CI gate is scoped to main pushes', () => {
  const ci = read('.github/workflows/ci.yml');
  const scratchStep = /- name: Check scratch namespace[\s\S]*?run: npm run check:scratch-namespace/;

  assert.match(ci, scratchStep);
  assert.match(ci, /if:\s+github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
});
```

- [ ] **Step 2: Run the focused config test to verify it fails**

Run:

```bash
node --test tests/open-source-config.test.mjs
```

Expected: FAIL because `.github/workflows/ci.yml` does not yet include the scratch namespace step.

- [ ] **Step 3: Add the scoped CI step**

Modify `.github/workflows/ci.yml` and add this step immediately after `Validate trigger layer`, keeping it inside the existing `steps:` list:

```diff
       - name: Validate trigger layer
         run: npm run validate
+
+      - name: Check scratch namespace
+        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
+        run: npm run check:scratch-namespace
```

This step must not run on ordinary `pull_request` branch heads.

- [ ] **Step 4: Run the focused config test**

Run:

```bash
node --test tests/open-source-config.test.mjs
```

Expected: PASS.

---

### Task 5: Full Verification And Atomic Commit

**Files:**

- Verify all files changed by Tasks 1-4.

- [ ] **Step 1: Run the complete verification suite**

Run:

```bash
npm run format:check
npm run lint
npm test
npm run validate
npm run check:scratch-namespace
```

Expected:

- `npm run format:check` passes.
- `npm run lint` passes.
- `npm test` passes.
- `npm run validate` passes.
- `npm run check:scratch-namespace` passes with no tracked `docs/superpowers/` files.

- [ ] **Step 2: Confirm the final tracked scratch namespace is empty**

Run:

```bash
git ls-files docs/superpowers/
```

Expected: no output.

- [ ] **Step 3: Inspect the implementation diff**

Run:

```bash
git status --short
git diff --stat
git diff -- .gitignore .github/workflows/ci.yml .github/PULL_REQUEST_TEMPLATE.md CONTRIBUTING.md package.json scripts/check-scratch-namespace.mjs tests/scratch-namespace-policy.test.mjs tests/open-source-config.test.mjs docs/designs docs/superpowers
```

Expected: the diff contains only the atomic scratch namespace rollout: cleanup, ignore rule, checker, scoped CI gate, contributor docs, PR checklist, tests, package script, and the plan deletion.

- [ ] **Step 4: Create one atomic implementation commit**

Run:

```bash
git add .gitignore .github/workflows/ci.yml .github/PULL_REQUEST_TEMPLATE.md CONTRIBUTING.md package.json scripts/check-scratch-namespace.mjs tests/scratch-namespace-policy.test.mjs tests/open-source-config.test.mjs docs/designs/2026-05-20-playbook-first-guidance-design.md docs/designs/2026-05-20-provenance-aware-plugin-sync-design.md
git add -u docs/superpowers
git commit -m "chore: enforce superpowers scratch namespace policy"
```

Expected: one commit that leaves `git ls-files docs/superpowers/` empty.

## Self-Review Checklist

- The implementation keeps branch-local `git add -f docs/superpowers/...` review possible.
- The blocking CI gate is scoped to `push` on `refs/heads/main`.
- `npm run validate` remains unchanged and does not become an unscoped scratch blocker.
- Durable existing specs graduate to `docs/designs/`.
- Completed existing plans leave the tracked tree.
- `.gitignore` prevents accidental future scratch staging.
- The PR checklist names the relocate-or-drop decision.
- `CONTRIBUTING.md` explains the lifecycle from outside `docs/superpowers/`.
- `git ls-files docs/superpowers/` produces no output after implementation.
