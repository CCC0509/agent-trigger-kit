# Session Check Read-Only And Scratch Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `agent-trigger-kit session-check` succeed against readable
read-only outcome stores while adding diagnostic write metadata and stopping
future `agent-trigger-kit-*` scratch residue from docs examples and tests.

**Architecture:** Keep `session-check` as a read-only command by splitting
outcome-store read health from write diagnostics inside
`scripts/session-check.mjs`. Add one shared temp-directory helper for tests,
then migrate every `mkdtempSync` test fixture to register `t.after()` cleanup.
Update docs and plugin skill wording, and ship the plugin-visible change with a
single aligned patch version bump.

**Tech Stack:** Node.js 20 ESM scripts, `node:test`, `node:fs` access checks,
Prettier, ESLint, existing Agent Trigger Kit version scripts.

---

## Execution Decisions

- Continue implementation on the current branch:
  `design-session-check-readonly-scratch-hygiene`. Keep the spec, plan, and
  implementation commits together so one PR can review the design trail and the
  code that implements it.
- Use subagent-driven execution sequentially: Task 1, then Task 2, then Task 3,
  then Task 4, then Task 5. The tasks have real dependencies, so do not run
  them in parallel.
- Assign all of Task 3 to one implementer subagent. The temp-helper migration
  touches many small files, but one agent should handle the sweep to keep import
  style and formatting consistent.
- Merge-prep decision: use relocate-plus-drop, not PR override. Graduate the
  accepted design spec from `docs/superpowers/specs/` into `docs/designs/`, and
  remove the non-durable execution plan from `docs/superpowers/plans/` before
  requesting merge.

## File Structure

- Create `tests/helpers/tmp.mjs`: shared temp directory helper with
  `mkdtempSync` and `t.after()` cleanup.
- Modify `tests/session-check.test.mjs`: use the temp helper, add failing
  read-only outcome-store tests, update JSON schema expectations.
- Modify `scripts/session-check.mjs`: change `probeOutcomeStore` read
  semantics, add write diagnostics, bump session-check payload schema to `0.2`,
  and render the new human report line.
- Modify these temp-using test files to call `makeTempDir(t, prefix)`:
  `tests/backfill-historical-outcomes.test.mjs`,
  `tests/live-trigger-surface-check.test.mjs`,
  `tests/outcome-mark-ux.test.mjs`,
  `tests/outcome-recorder.test.mjs`,
  `tests/outcome-report.test.mjs`,
  `tests/premerge-version-check.test.mjs`,
  `tests/scratch-namespace-policy.test.mjs`, `tests/script-lib.test.mjs`,
  `tests/trigger-layer-scripts.test.mjs`.
- Modify `CONTRIBUTING.md`: replace fixed `/private/tmp` npm cache examples
  with a disposable `mktemp` cache and link the scratch hygiene note.
- Create `docs/designs/2026-05-24-scratch-hygiene-note.md`: durable manual
  scratch hygiene note for sandbox HOME fallback and fixed-name artifacts.
- Modify `plugins/agent-trigger-kit/skills/session-check/SKILL.md`: clarify
  that `session-check` only needs readable outcome-store state.
- Modify aligned version files after the plugin-visible skill change:
  `package.json`, `package-lock.json`, `.agents/plugins/marketplace.json`,
  `.claude-plugin/marketplace.json`,
  `plugins/agent-trigger-kit/.codex-plugin/plugin.json`,
  `plugins/agent-trigger-kit/.claude-plugin/plugin.json`, and `CHANGELOG.md`.

## Task 1: Add Failing Session-Check Read-Only Tests

**Files:**

- Create: `tests/helpers/tmp.mjs`
- Modify: `tests/session-check.test.mjs`

- [ ] **Step 1: Create the temp helper**

Create `tests/helpers/tmp.mjs`:

```js
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeTempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
```

- [ ] **Step 2: Update session-check test imports**

In `tests/session-check.test.mjs`, replace the existing fs/os imports:

```js
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
```

with:

```js
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
```

Remove the `tmpdir` import. Add the helper import after the production imports:

```js
import { makeTempDir } from './helpers/tmp.mjs';
```

- [ ] **Step 3: Update session-check temp helper functions**

Replace `makeRoot()` and `makeHome()` in `tests/session-check.test.mjs` with:

```js
function makeRoot(t) {
  return makeTempDir(t, 'agent-trigger-kit-session-root-');
}

function makeHome(t) {
  return makeTempDir(t, 'agent-trigger-kit-session-home-');
}

function restoreWritable(path) {
  if (existsSync(path)) {
    chmodSync(path, 0o700);
  }
}
```

- [ ] **Step 4: Pass the test context through existing session-check tests**

For every existing test in `tests/session-check.test.mjs`, change the callback
from `() => {` to `(t) => {`, then pass `t` to each temp helper call. The file
should use these forms:

```js
const root = makeRoot(t);
const homeDir = makeHome(t);
```

For the help test, which only creates a home directory, use:

```js
const homeDir = makeHome(t);
```

- [ ] **Step 5: Add the absent-directory unwritable-ancestor test**

Add this test after the happy-path test:

```js
test('session-check treats absent outcome dir with unwritable ancestor as healthy read-only state', (t) => {
  const root = makeRoot(t);
  const homeDir = makeHome(t);
  createValidTriggerLayer(root);
  chmodSync(homeDir, 0o500);
  t.after(() => restoreWritable(homeDir));

  const result = runCli(['session-check', '--root', root, '--json'], homeDir);

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.exit_code, 0);
  assert.equal(payload.outcome_store.status, 'ok');
  assert.equal(payload.outcome_store.writable, false);
  assert.equal(payload.outcome_store.writable_reason, 'ancestor not writable');
  assert.equal(payload.unmarked_events.count, 0);
});
```

- [ ] **Step 6: Add the read-only existing-directory test**

Add this test after the absent-directory test:

```js
test('session-check treats readable read-only outcome dir as healthy with write diagnostics', (t) => {
  const root = makeRoot(t);
  const homeDir = makeHome(t);
  createValidTriggerLayer(root);
  const store = outcomeStorePath({ root, homeDir, store: 'user' });
  mkdirSync(store.dir, { recursive: true });
  chmodSync(store.dir, 0o500);
  t.after(() => restoreWritable(store.dir));

  const result = runCli(['session-check', '--root', root, '--json'], homeDir);

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.exit_code, 0);
  assert.equal(payload.outcome_store.status, 'ok');
  assert.equal(payload.outcome_store.writable, false);
  assert.equal(payload.outcome_store.writable_reason, 'outcome directory read-only');
});
```

- [ ] **Step 7: Update the stable JSON shape assertion**

In the `session-check JSON exposes stable schema fields for start and closeout
modes` test, change:

```js
assert.equal(startPayload.schema_version, '0.1');
```

to:

```js
assert.equal(startPayload.schema_version, '0.2');
assert.deepEqual(Object.keys(startPayload.outcome_store), [
  'status',
  'store',
  'project_hash',
  'dir',
  'events_path',
  'writable',
  'writable_reason',
  'error',
]);
assert.equal(typeof startPayload.outcome_store.writable, 'boolean');
assert.equal(startPayload.outcome_store.writable_reason, null);
```

- [ ] **Step 8: Run the targeted tests to verify they fail first**

Run:

```bash
npm test -- tests/session-check.test.mjs
```

Expected now: FAIL. At least one new test should report an actual exit status
of `3` where the assertion expects `0`, and the JSON-shape test should still
see schema version `0.1`.

- [ ] **Step 9: Commit the failing tests**

```bash
git add tests/helpers/tmp.mjs tests/session-check.test.mjs
git commit -m "test: cover read-only session-check outcome stores"
```

## Task 2: Implement Read-Only Session-Check Semantics

**Files:**

- Modify: `scripts/session-check.mjs`
- Test: `tests/session-check.test.mjs`

- [ ] **Step 1: Add a session-check payload schema constant**

Near the existing `WINDOW_MS` constant in `scripts/session-check.mjs`, add:

```js
const SESSION_CHECK_SCHEMA_VERSION = '0.2';
```

Replace each `schema_version: '0.1'` in this file with:

```js
schema_version: SESSION_CHECK_SCHEMA_VERSION,
```

- [ ] **Step 2: Replace `probeOutcomeStore` with read-first semantics**

Replace the current `probeOutcomeStore` function with:

```js
export function probeOutcomeStore({ root = process.cwd(), homeDir = homedir() } = {}) {
  let storePath;
  try {
    storePath = outcomeStorePath({ root, homeDir, store: 'user' });
  } catch (error) {
    return degradedStore({ storePath, error });
  }

  const writable = probeOutcomeStoreWritable(storePath);
  const base = {
    status: 'ok',
    store: storePath.store,
    project_hash: storePath.projectHash,
    dir: storePath.dir,
    events_path: storePath.eventsPath,
    writable: writable.writable,
    writable_reason: writable.reason,
    error: null,
  };

  try {
    if (existsSync(storePath.dir)) {
      const dirStat = statSync(storePath.dir);
      if (!dirStat.isDirectory()) {
        throw new Error(`outcome store path is not a directory: ${storePath.dir}`);
      }
      accessSync(storePath.dir, R_OK);

      if (existsSync(storePath.eventsPath)) {
        const eventsStat = statSync(storePath.eventsPath);
        if (!eventsStat.isFile()) {
          throw new Error(`outcome events path is not a file: ${storePath.eventsPath}`);
        }
        accessSync(storePath.eventsPath, R_OK);
        validateOutcomeEventsFile(storePath.eventsPath);
      }

      return base;
    }

    const ancestor = nearestExistingAncestor(storePath.dir);
    const ancestorStat = statSync(ancestor);
    if (!ancestorStat.isDirectory()) {
      throw new Error(`outcome store ancestor is not a directory: ${ancestor}`);
    }

    return base;
  } catch (error) {
    return {
      ...base,
      status: 'degraded',
      error: serializeError(error),
    };
  }
}
```

- [ ] **Step 3: Add write-diagnostic helper functions**

Add these helpers below `nearestExistingAncestor`:

```js
function probeOutcomeStoreWritable(storePath) {
  if (!storePath) return writeProbe(false, 'not checked');

  try {
    if (!existsSync(storePath.dir)) {
      const ancestor = nearestExistingAncestor(storePath.dir);
      const ancestorStat = statSync(ancestor);
      if (!ancestorStat.isDirectory()) {
        return writeProbe(false, 'ancestor not a directory');
      }
      return accessWritable(ancestor, 'ancestor not writable');
    }

    const dirStat = statSync(storePath.dir);
    if (!dirStat.isDirectory()) {
      return writeProbe(false, 'outcome directory not a directory');
    }

    const dirWritable = accessWritable(storePath.dir, 'outcome directory read-only');
    if (!dirWritable.writable) return dirWritable;

    if (existsSync(storePath.eventsPath)) {
      const eventsStat = statSync(storePath.eventsPath);
      if (!eventsStat.isFile()) {
        return writeProbe(false, 'events path not a file');
      }
      return accessWritable(storePath.eventsPath, 'events file read-only');
    }

    return writeProbe(true);
  } catch (error) {
    return writeProbe(false, error?.message || 'write probe failed');
  }
}

function accessWritable(path, reason) {
  try {
    accessSync(path, W_OK);
    return writeProbe(true);
  } catch {
    return writeProbe(false, reason);
  }
}

function writeProbe(writable, reason = null) {
  return {
    writable,
    reason: writable ? null : reason,
  };
}
```

- [ ] **Step 4: Add write fields to degraded, help, and usage payloads**

Replace `degradedStore` with:

```js
function degradedStore({ storePath, error }) {
  const writable = probeOutcomeStoreWritable(storePath);
  return {
    status: 'degraded',
    store: storePath?.store || 'user',
    project_hash: storePath?.projectHash || null,
    dir: storePath?.dir || null,
    events_path: storePath?.eventsPath || null,
    writable: writable.writable,
    writable_reason: writable.reason,
    error: serializeError(error),
  };
}
```

In the `outcome_store` objects inside `helpResult` and `usageResult`, add:

```js
writable: false,
writable_reason: 'not checked',
```

directly before `error`.

- [ ] **Step 5: Render the human Writable line**

In `writeHumanReport`, after the `- Path:` line, add:

```js
const writableText = payload.outcome_store.writable
  ? 'yes'
  : `no (${payload.outcome_store.writable_reason || 'unknown'})`;
stdout.write(`- Writable: ${writableText}\n`);
```

The `Outcome store` section should print status, path, writable, and then error
when an error exists.

- [ ] **Step 6: Run targeted tests**

Run:

```bash
npm test -- tests/session-check.test.mjs
```

Expected: PASS for all `tests/session-check.test.mjs` tests.

- [ ] **Step 7: Run a manual JSON smoke check**

Run:

```bash
node scripts/cli.mjs session-check --root . --json
```

Expected: JSON output with `"schema_version": "0.2"` and an
`outcome_store.writable` boolean. The command should exit `0` when validation
passes and no unmarked events exist, even if the caller's real HOME is
read-only but readable.

- [ ] **Step 8: Commit the implementation**

```bash
git add scripts/session-check.mjs tests/session-check.test.mjs tests/helpers/tmp.mjs
git commit -m "fix: make session-check outcome probe read-only"
```

## Task 3: Add Temp Cleanup To Remaining Tests

**Files:**

- Modify: `tests/backfill-historical-outcomes.test.mjs`
- Modify: `tests/live-trigger-surface-check.test.mjs`
- Modify: `tests/outcome-mark-ux.test.mjs`
- Modify: `tests/outcome-recorder.test.mjs`
- Modify: `tests/outcome-report.test.mjs`
- Modify: `tests/premerge-version-check.test.mjs`
- Modify: `tests/scratch-namespace-policy.test.mjs`
- Modify: `tests/script-lib.test.mjs`
- Modify: `tests/trigger-layer-scripts.test.mjs`
- Test: all modified test files

- [ ] **Step 1: Confirm the remaining direct temp creators**

Run:

```bash
rg -n "mkdtempSync|tmpdir\\(" tests/*.test.mjs
```

Expected before this task: matches in the nine files listed above. Do not count
`tests/session-check.test.mjs`, because Task 1 already migrated it.

- [ ] **Step 2: Migrate `tests/outcome-mark-ux.test.mjs`**

Change imports from:

```js
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
```

to no fs/os temp imports. Add:

```js
import { makeTempDir } from './helpers/tmp.mjs';
```

Replace helpers with:

```js
function makeRoot(t) {
  return makeTempDir(t, 'agent-trigger-kit-mark-ux-root-');
}

function makeHome(t) {
  return makeTempDir(t, 'agent-trigger-kit-mark-ux-home-');
}
```

Change every test callback in the file to `(t) => {` and pass `t` to
`makeRoot(t)` and `makeHome(t)`.

- [ ] **Step 3: Migrate `tests/outcome-report.test.mjs`**

Change imports from:

```js
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
```

to:

```js
import { writeFileSync } from 'node:fs';
```

Add:

```js
import { makeTempDir } from './helpers/tmp.mjs';
```

Replace helpers with:

```js
function makeRoot(t) {
  return makeTempDir(t, 'agent-trigger-kit-report-root-');
}

function makeHome(t) {
  return makeTempDir(t, 'agent-trigger-kit-report-home-');
}
```

Change every test callback in the file to `(t) => {` and pass `t` to
`makeRoot(t)` and `makeHome(t)`.

- [ ] **Step 4: Migrate `tests/outcome-recorder.test.mjs`**

Remove `mkdtempSync` from the `node:fs` import and remove the `tmpdir` import.
Add:

```js
import { makeTempDir } from './helpers/tmp.mjs';
```

Replace helpers with:

```js
function makeRoot(t, prefix = 'agent-trigger-kit-outcome-root-') {
  return makeTempDir(t, prefix);
}

function makeHome(t) {
  return makeTempDir(t, 'agent-trigger-kit-outcome-home-');
}
```

Change every test callback in the file to `(t) => {`. Pass `t` into all
`makeRoot` and `makeHome` calls, including custom-prefix calls:

```js
const root = makeRoot(t);
const customRoot = makeRoot(t, 'agent-trigger-kit-outcome-custom-root-');
const homeDir = makeHome(t);
```

- [ ] **Step 5: Migrate `tests/backfill-historical-outcomes.test.mjs`**

Change imports from:

```js
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
```

to:

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
```

Add:

```js
import { makeTempDir } from './helpers/tmp.mjs';
```

Replace the helper with:

```js
function makeRoot(t) {
  return makeTempDir(t, 'agent-trigger-kit-backfill-');
}
```

Change every test callback in the file to `(t) => {` and pass `t` to
`makeRoot(t)`.

- [ ] **Step 6: Migrate `tests/live-trigger-surface-check.test.mjs`**

Remove `mkdtempSync` from the `node:fs` import and remove the `tmpdir` import.
Add:

```js
import { makeTempDir } from './helpers/tmp.mjs';
```

Replace the helper with:

```js
function makeRoot(t) {
  return makeTempDir(t, 'agent-trigger-kit-live-trigger-surface-');
}
```

Change every test callback in the file to `(t) => {` and pass `t` to
`makeRoot(t)`.

- [ ] **Step 7: Migrate `tests/premerge-version-check.test.mjs`**

Remove `mkdtempSync` from the `node:fs` import and remove the `tmpdir` import.
Add:

```js
import { makeTempDir } from './helpers/tmp.mjs';
```

Replace the helper with:

```js
function makeRoot(t) {
  return makeTempDir(t, 'agent-trigger-kit-premerge-test-');
}
```

Change every test callback in the file to `(t) => {` and pass `t` to
`makeRoot(t)`. The existing call that builds `gitDir` should become:

```js
const gitDir = join(makeRoot(t), 'actual-git-dir');
```

- [ ] **Step 8: Migrate `tests/scratch-namespace-policy.test.mjs`**

Change imports from:

```js
import { rmSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
```

to:

```js
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
```

Add:

```js
import { makeTempDir } from './helpers/tmp.mjs';
```

Replace the helper with:

```js
function makeRoot(t) {
  return makeTempDir(t, 'agent-trigger-kit-scratch-test-');
}
```

Change every test callback in the file to `(t) => {` and pass `t` to
`makeRoot(t)`.

- [ ] **Step 9: Migrate `tests/script-lib.test.mjs`**

Change imports from:

```js
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
```

to:

```js
import { existsSync, readFileSync } from 'node:fs';
```

Add:

```js
import { makeTempDir } from './helpers/tmp.mjs';
```

Replace the helper with:

```js
function makeRoot(t) {
  return makeTempDir(t, 'agent-trigger-kit-lib-test-');
}
```

Change every test callback in the file to `(t) => {` and pass `t` to
`makeRoot(t)`.

- [ ] **Step 10: Migrate `tests/trigger-layer-scripts.test.mjs`**

Remove `mkdtempSync` from the `node:fs` import and remove the `tmpdir` import.
Add:

```js
import { makeTempDir } from './helpers/tmp.mjs';
```

Replace the helper with:

```js
function makeRoot(t) {
  return makeTempDir(t, 'agent-trigger-kit-test-');
}
```

Change every test callback in the file to `(t) => {` and pass `t` to
`makeRoot(t)`.

- [ ] **Step 11: Confirm no direct test-file temp creators remain**

Run:

```bash
rg -n "mkdtempSync|tmpdir\\(" tests/*.test.mjs
```

Expected: no output.

Run:

```bash
rg -n "mkdtempSync|tmpdir\\(" tests/helpers/tmp.mjs
```

Expected: two matches in `tests/helpers/tmp.mjs`.

- [ ] **Step 12: Run the migrated tests**

Run:

```bash
npm test -- \
  tests/backfill-historical-outcomes.test.mjs \
  tests/live-trigger-surface-check.test.mjs \
  tests/outcome-mark-ux.test.mjs \
  tests/outcome-recorder.test.mjs \
  tests/outcome-report.test.mjs \
  tests/premerge-version-check.test.mjs \
  tests/scratch-namespace-policy.test.mjs \
  tests/script-lib.test.mjs \
  tests/trigger-layer-scripts.test.mjs
```

Expected: PASS.

- [ ] **Step 13: Commit the test cleanup sweep**

```bash
git add tests
git commit -m "test: clean up scratch temp directories"
```

## Task 4: Update Docs, Skill Text, Version, And Changelog

**Files:**

- Modify: `CONTRIBUTING.md`
- Create: `docs/designs/2026-05-24-scratch-hygiene-note.md`
- Modify: `plugins/agent-trigger-kit/skills/session-check/SKILL.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.agents/plugins/marketplace.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `plugins/agent-trigger-kit/.codex-plugin/plugin.json`
- Modify: `plugins/agent-trigger-kit/.claude-plugin/plugin.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Replace fixed npm cache examples**

In `CONTRIBUTING.md`, replace:

```bash
npm exec --cache /private/tmp/agent-trigger-kit-npm-cache --yes --package . -- agent-trigger-kit --help
npm pack --cache /private/tmp/agent-trigger-kit-npm-cache --dry-run --json
```

with:

```bash
npm_cache="$(mktemp -d -t agent-trigger-kit-npm-cache.XXXXXX)"
trap 'rm -rf "$npm_cache"' EXIT
npm exec --cache "$npm_cache" --yes --package . -- agent-trigger-kit --help
npm pack --cache "$npm_cache" --dry-run --json
```

- [ ] **Step 2: Add a scratch hygiene note under docs**

Create `docs/designs/2026-05-24-scratch-hygiene-note.md`:

````markdown
# Scratch Hygiene Note

**Status:** Durable operations note for manual Agent Trigger Kit development
flows.

Temporary Agent Trigger Kit artifacts belong under randomized scratch paths and
must be removed when the session that created them ends.

Use randomized paths for sandbox HOME fallbacks. Prefer names such as
`agent-trigger-kit-session-<random>` created through `mktemp -d` instead of a
fixed path:

```bash
scratch_home="$(mktemp -d -t agent-trigger-kit-session.XXXXXX)"
trap 'rm -rf "$scratch_home"' EXIT
HOME="$scratch_home" npm run validate
```

Any fixed-name artifact under `${TMPDIR}/agent-trigger-kit-*` or
`/private/tmp/agent-trigger-kit-*`, whether it is a file or directory, is
short-lived scratch. If it survives more than one session, it is an orphan and
belongs to ops cleanup.

This note covers future hygiene only. Existing `/private/tmp` residue is not
part of feature implementation scope.
````

- [ ] **Step 3: Link the scratch hygiene note from contributor docs**

In `CONTRIBUTING.md`, after the paragraph that explains the non-blocking
Scratch Namespace Advisory check, add:

```markdown
For local scratch files outside the repository, use randomized temporary paths
and remove them at session end. See
`docs/designs/2026-05-24-scratch-hygiene-note.md` for the current scratch
hygiene rule covering `${TMPDIR}/agent-trigger-kit-*` and
`/private/tmp/agent-trigger-kit-*` artifacts.
```

- [ ] **Step 4: Clarify the session-check skill text**

In `plugins/agent-trigger-kit/skills/session-check/SKILL.md`, replace:

```text
The check is read-only. Avoid hooks, background automation, or background
triggers for session-check behavior.
```

with:

```text
The check is read-only. It does not need the outcome store to be writable; it
only needs readable existing state, so it can still succeed under sandboxed
HOME directories where writes are blocked. Avoid hooks, background automation,
or background triggers for session-check behavior.
```

- [ ] **Step 5: Verify the version bump script interface**

`scripts/bump-plugin-version.mjs` does not currently expose a dry-run mode, so
verify the exact flags before running the mutating command:

```bash
rg -n "booleanKeys: \\['include-package'|const pluginName = requiredArg\\(args, 'plugin'\\)|const requestedNext = args.next|--next must be patch" scripts/bump-plugin-version.mjs
```

Expected: matches showing `include-package` is a boolean flag, `plugin` is a
required arg, `next` is read from args, and `--next` accepts `patch`.

- [ ] **Step 6: Bump aligned plugin/source versions**

Run:

```bash
node scripts/bump-plugin-version.mjs --plugin agent-trigger-kit --next patch --include-package
```

Expected stdout:

```text
updated package.json
updated .agents/plugins/marketplace.json
updated plugins/agent-trigger-kit/.codex-plugin/plugin.json
updated .claude-plugin/marketplace.json
updated plugins/agent-trigger-kit/.claude-plugin/plugin.json
```

- [ ] **Step 7: Update package-lock version fields**

Run:

```bash
npm install --package-lock-only --ignore-scripts
```

Expected: `package-lock.json` root `version` and `packages[""].version` match
the new package version.

- [ ] **Step 8: Add the changelog entry**

At the top of `CHANGELOG.md`, directly above `## 0.2.1`, add:

```markdown
## 0.2.2

- Session check: treats readable read-only outcome stores as healthy, reports
  outcome-store writability as diagnostic JSON and human output, and keeps the
  existing exit-code table unchanged.
- Scratch hygiene: replaces fixed `/private/tmp/agent-trigger-kit-*` examples
  with disposable temp paths and cleans test-created temp directories after
  each run.
```

If the version produced by `bump-plugin-version.mjs` is not `0.2.2`, use the
actual new version in the heading.

- [ ] **Step 9: Verify aligned source versions**

Run:

```bash
npm run ops:plugin-version-check -- --surface source agent-trigger-kit
```

Expected: all source version entries report the same new version and the command
exits `0`.

- [ ] **Step 10: Check tracked docs, plugin surfaces, and tests for fixed scratch paths**

Run:

```bash
rg -n -g '!docs/superpowers/**' "/private/tmp/agent-trigger-kit|HOME=/private/tmp/agent-trigger-kit|--cache /private/tmp/agent-trigger-kit" CONTRIBUTING.md docs plugins README.md tests
```

Expected: no matches. The command explicitly excludes `docs/superpowers/**`
because this branch intentionally tracks review artifacts that discuss the old
scratch paths.

- [ ] **Step 11: Commit docs and version changes**

```bash
git add \
  CONTRIBUTING.md \
  docs/designs/2026-05-24-scratch-hygiene-note.md \
  plugins/agent-trigger-kit/skills/session-check/SKILL.md \
  package.json \
  package-lock.json \
  .agents/plugins/marketplace.json \
  .claude-plugin/marketplace.json \
  plugins/agent-trigger-kit/.codex-plugin/plugin.json \
  plugins/agent-trigger-kit/.claude-plugin/plugin.json \
  CHANGELOG.md
git commit -m "docs: clarify session-check scratch hygiene"
```

## Task 5: Final Verification And Closeout

**Files:**

- Verify: full repository
- Modify: `docs/superpowers/specs/2026-05-24-session-check-readonly-and-scratch-hygiene-design.md`
- Delete: `docs/superpowers/plans/2026-05-24-session-check-readonly-and-scratch-hygiene.md`
- Create: `docs/designs/2026-05-24-session-check-readonly-and-scratch-hygiene-design.md`
- Commit: final fixups only if verification requires edits

- [ ] **Step 1: Run the targeted session-check tests**

Run:

```bash
npm test -- tests/session-check.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run lint and format checks**

Run:

```bash
npm run lint
npm run format:check
```

Expected: both commands exit `0`.

- [ ] **Step 4: Run trigger-layer validation**

Run:

```bash
npm run validate
```

Expected: trigger layer validation passes.

- [ ] **Step 5: Run source version verification**

Run:

```bash
npm run ops:plugin-version-check -- --surface source agent-trigger-kit
```

Expected: command exits `0` and prints one aligned source version.

- [ ] **Step 6: Run the new session-check behavior manually**

Run:

```bash
scratch_home="$(mktemp -d -t agent-trigger-kit-session.XXXXXX)"
chmod 500 "$scratch_home"
HOME="$scratch_home" node scripts/cli.mjs session-check --root . --json
chmod 700 "$scratch_home"
rm -rf "$scratch_home"
```

Expected JSON fields:

```json
{
  "schema_version": "0.2",
  "exit_code": 0,
  "outcome_store": {
    "status": "ok",
    "writable": false,
    "writable_reason": "ancestor not writable"
  }
}
```

The actual JSON includes more fields; confirm the listed fields have these
values.

- [ ] **Step 7: Run session closeout**

Run:

```bash
agent-trigger-kit session-check --closeout
```

Expected after the fix: exit `0` when validation passes and no unmarked events
exist, even if the real HOME outcome store is readable but not writable. If
this still exits `3`, inspect the printed `Outcome store` error and fix the
remaining read-path degradation before reporting completion.

- [ ] **Step 8: Prepare scratch docs for merge**

The spec and plan are branch-local review artifacts while implementation is in
progress. The chosen merge-prep policy is relocate durable design content and
drop non-durable planning content; do not rely on a PR-description override.
Before a merge-ready branch, graduate the accepted design and remove the
execution plan from the tracked scratch namespace:

```bash
git mv docs/superpowers/specs/2026-05-24-session-check-readonly-and-scratch-hygiene-design.md docs/designs/2026-05-24-session-check-readonly-and-scratch-hygiene-design.md
git rm docs/superpowers/plans/2026-05-24-session-check-readonly-and-scratch-hygiene.md
npm run check:scratch-namespace
git add docs/designs/2026-05-24-session-check-readonly-and-scratch-hygiene-design.md
git commit -m "docs: graduate session-check readonly design"
```

Expected: `npm run check:scratch-namespace` exits `0` because
`git ls-files docs/superpowers/` produces no tracked files.

- [ ] **Step 9: Inspect repository state**

Run:

```bash
git status --short --branch
```

Expected: clean worktree after all commits. If `docs/superpowers/` files remain
tracked for review, the branch is not merge-ready; complete Step 8 before
requesting merge.

## Plan Self-Review

- Spec coverage: Tasks 1 and 2 cover read-only outcome-store semantics,
  schema version `0.2`, `writable`, `writable_reason`, human output, and the
  unchanged exit-code table. Task 3 covers test temp cleanup. Task 4 covers docs,
  manual scratch hygiene, the session-check skill text, the aligned version
  bump, changelog, and fixed scratch path scanning across tests. Task 5 covers
  verification, closeout, and merge-ready scratch namespace cleanup.
- Scope check: no new CLI, no outcome recorder write-path change, no existing
  `/private/tmp` cleanup, and no `--no-outcome` validator behavior change.
- Version check: the plugin-visible skill edit is committed together with the
  aligned version bump.
