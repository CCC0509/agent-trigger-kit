# Session Check Read-Only And Scratch Hygiene Design

**Goal:** Make `agent-trigger-kit session-check` truthful about being
read-only, and stop future manual flows, docs examples, and tests from leaving
fixed or uncollected `agent-trigger-kit-*` scratch artifacts under temporary
directories.

**Status:** Accepted design spec. This file has graduated from branch-local
review material under `docs/superpowers/` into `docs/designs/` as the durable
record for the implementation.

## Review Synthesis

The proposed scope is correct: keep the CLI surface and exit-code table stable,
change only the read probe semantics, and handle scratch hygiene at the sources
that create future residue.

Two implementation clarifications are required:

- Temp-dir cleanup should cover every test file that currently calls
  `mkdtempSync` with an `agent-trigger-kit-*` prefix. Repo inspection found ten
  such files, not nine, because `tests/outcome-recorder.test.mjs` also creates
  temp roots and homes.
- Updating `plugins/agent-trigger-kit/skills/session-check/SKILL.md` is a
  plugin-visible change. The implementation branch must bump the aligned
  version across `package.json`, package lock, Codex marketplace/plugin
  manifests, and Claude marketplace/plugin manifests before commit or push.

No section should be cut. The preexisting `/private/tmp` artifacts, including
`/private/tmp/agent-trigger-kit-prettierignore-task6`, remain outside this
implementation and belong to an ops cleanup.

## Current Problem

`session-check` is documented as read-only, but
`scripts/session-check.mjs` currently treats the user outcome store as healthy
only when it is writable. That makes read-only sandbox runs fail with exit code
`3` even when all session-check behavior can be satisfied by reading existing
data or by treating a missing store as empty.

Separately, fixed examples and uncleaned tests can leave files or directories
under `${TMPDIR}/agent-trigger-kit-*` or `/private/tmp/agent-trigger-kit-*`.
Those names are useful for short-lived scratch work, but fixed names and missing
test teardown make old artifacts look like active state.

## Non-Goals

- Do not change the `session-check` exit-code table.
- Do not change `--no-outcome` behavior in validator paths.
- Do not add `clean-scratch` or any other CLI.
- Do not clean existing `/private/tmp` residue as part of the implementation.
- Do not change the outcome recorder write path.
- Do not add an external schema-validator migration for the
  `session-check` JSON payload.

## Session Check Behavior

`probeOutcomeStore` should require readability, not writability, for the data it
needs to inspect.

### Outcome Directory

When the outcome directory does not exist, `probeOutcomeStore` should return
`status: "ok"` after path derivation succeeds. It must not require the nearest
existing ancestor to be writable. A missing store is a valid empty read-only
state for `session-check`.

When the outcome directory exists:

- If the path is not a directory, return `status: "degraded"` and keep exit
  code `3`.
- If the directory is not readable, return `status: "degraded"` and keep exit
  code `3`.
- If the directory is readable, continue. Directory writability becomes
  diagnostic-only metadata.

### Events File

When the events file does not exist, `probeOutcomeStore` should continue to
return `status: "ok"` as long as the directory checks above pass.

When the events path exists:

- If the path is not a file, return `status: "degraded"` and keep exit code `3`.
- If the file is not readable, return `status: "degraded"` and keep exit code
  `3`.
- If the file contains invalid JSON or records that fail the existing outcome
  event schema, return `status: "degraded"` and keep exit code `3`.
- If the file is readable and valid, return `status: "ok"`. File writability
  becomes diagnostic-only metadata.

### Exit Codes

The exit-code precedence remains unchanged:

- `0`: healthy.
- `1`: trigger-layer validation failed.
- `2`: usage error.
- `3`: degraded outcome store.
- `4`: unmarked outcome events.

The key behavior change is that a read-only but readable outcome store no
longer counts as degraded. A sandbox run that currently exits `3` only because
`W_OK` fails should exit `0`, unless validation fails or unmarked events are
present.

## JSON Payload

The `session-check` payload schema version should move from `0.1` to `0.2`.
This is the payload owned by `scripts/session-check.mjs`; it does not change
the outcome event schema in `scripts/lib/outcome-schema.mjs`.

`outcome_store` gains two fields:

- `writable`: boolean. `true` only when the relevant write surface is writable.
  For an absent outcome directory, check the nearest existing ancestor. For an
  existing directory without an events file, check the directory. For an
  existing events file, check both the directory and events file.
- `writable_reason`: string or `null`. Use `null` when `writable` is `true`.
  Use a concise reason when `writable` is `false`, such as
  `"ancestor not writable"`, `"outcome directory read-only"`, or
  `"events file read-only"`.

For `status: "not_run"` payloads produced by help or usage-error paths, include
`writable: false` and `writable_reason: "not checked"` so the field shape stays
stable without probing the filesystem.

`writable: false` is diagnostic-only and must not affect `exit_code`.

The human report should add one line under `Outcome store`:

```text
- Writable: yes
```

or:

```text
- Writable: no (events file read-only)
```

## Documentation Changes

Update `plugins/agent-trigger-kit/skills/session-check/SKILL.md` to keep the
read-only claim and make it precise:

```text
session-check does not need the outcome store to be writable; it only needs
readable existing state. It can still succeed under sandboxed HOME directories
where writes are blocked.
```

Do not change `CLAUDE.md` or `AGENTS.md`; their current wording is already
compatible with read-only behavior.

Update contributor scratch guidance so examples do not use fixed
`/private/tmp/agent-trigger-kit-*` names. In `CONTRIBUTING.md`, replace fixed
npm cache commands with a disposable cache directory, for example:

```bash
npm_cache="$(mktemp -d -t agent-trigger-kit-npm-cache.XXXXXX)"
trap 'rm -rf "$npm_cache"' EXIT
npm exec --cache "$npm_cache" --yes --package . -- agent-trigger-kit --help
npm pack --cache "$npm_cache" --dry-run --json
```

Add a durable scratch hygiene note in the docs surface used for manual flows.
The note should say:

- Sandbox HOME fallbacks should use randomized names such as
  `agent-trigger-kit-session-<random>` and should be removed before the session
  ends.
- Any fixed-name artifact at `${TMPDIR}/agent-trigger-kit-*` or
  `/private/tmp/agent-trigger-kit-*`, whether file or directory, is short-lived
  scratch. If it survives more than one session, it is an orphan.
- Existing orphan cleanup is an ops task, not part of this implementation.

## Scratch Hygiene Implementation

Add a shared test helper, preferably `tests/helpers/tmp.mjs`, with a function
that creates a temp directory and registers teardown:

```js
export function makeTempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
```

Update test helpers that create temp roots or homes to accept the `node:test`
context and call the shared helper. Test bodies that allocate temp directories
should use `(t) => { ... }`.

Apply this to every current `mkdtempSync` user:

- `tests/backfill-historical-outcomes.test.mjs`
- `tests/live-trigger-surface-check.test.mjs`
- `tests/outcome-mark-ux.test.mjs`
- `tests/outcome-recorder.test.mjs`
- `tests/outcome-report.test.mjs`
- `tests/premerge-version-check.test.mjs`
- `tests/scratch-namespace-policy.test.mjs`
- `tests/script-lib.test.mjs`
- `tests/session-check.test.mjs`
- `tests/trigger-layer-scripts.test.mjs`

Do not add cleanup to tests that do not create temp directories.

## Tests

Update `tests/session-check.test.mjs` for the behavior change:

- Add temp-dir teardown via the shared helper.
- Add a case where the outcome directory is absent and the nearest existing
  ancestor is not writable. Expected result: exit `0`, `outcome_store.status`
  is `"ok"`, `outcome_store.writable` is `false`, and
  `outcome_store.writable_reason` is set.
- Add a case where the outcome directory exists and is readable but not
  writable. Expected result: exit `0`, `outcome_store.status` is `"ok"`, and
  `outcome_store.writable` is `false`.
- Update the stable JSON payload test to expect `schema_version: "0.2"` and
  the new `outcome_store.writable` and `outcome_store.writable_reason` fields.
- Keep degraded coverage for a non-directory outcome path, an events path that
  is not a file, and a corrupt events file. These failures are still degraded
  read failures or structural failures.

No separate strict schema-validator test is needed. The repository has no
current strict consumer for the `session-check` JSON payload, and this change
only asserts that the new fields appear in the existing payload tests.

## Backward Compatibility

CLI flags, exit-code meanings, and stderr behavior remain stable. Human stdout
adds one diagnostic line.

The JSON payload version bump from `0.1` to `0.2` can break strict external
consumers that pin the old shape. Repo inspection found no internal strict
consumer. This design accepts the breaking schema bump because the new payload
fields clarify behavior without changing command semantics.

## Verification

Run targeted tests after implementation:

```bash
npm test -- tests/session-check.test.mjs
```

Run the full test suite because the shared temp helper touches many files:

```bash
npm test
```

Run formatting and linting:

```bash
npm run format:check
npm run lint
```

Run trigger-layer validation:

```bash
npm run validate
```

Run plugin version verification after the required plugin-visible version bump:

```bash
npm run ops:plugin-version-check -- --surface source
```

Do not run `npm run check:scratch-namespace` while this branch intentionally
tracks the branch-local spec under `docs/superpowers/`; it is expected to fail
until the spec is relocated or dropped before merge.
