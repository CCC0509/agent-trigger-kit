status: v0.1-draft
date: 2026-05-23
primary_hypothesis: propagation-reliability
invalidates_when: outcome schema v0.2 changes required event fields, historical incidents require mark-style reclassification, or public seed sanitization cannot preserve useful baseline signal
see_also: 2026-05-23-cross-agent-trigger-reliability-problem-statement.md, 2026-05-23-outcome-event-schema-v0.1.md, 2026-05-23-outcome-recorder-mvp-design.md

# Outcome Historical Backfill

## Context And Scope

The outcome recorder now writes schema v0.1 records, but the ledger starts empty
except for events produced after the recorder landed. The propagation reliability
hypothesis needs an initial historical baseline so reports can compare future
auto-emitted evidence against known cache, version, routing, manifest, and
release-policy incidents.

This design defines a small manual seed file and a one-shot backfill script that
turns sanitized historical incidents into schema v0.1 `kind: "event"` records.
The script writes to the same outcome JSONL store as the recorder and uses the
same validator before writing.

## Non-Goals

This design does not change schema v0.1, add migration tooling, backfill mark
records, scrape GitHub issues or git history, infer timezones, or add a new
`agent-trigger-kit outcome` CLI verb. It also does not define dashboard or
report-polish behavior beyond producing valid records that later reports can
consume.

## Seed File Structure

### Public Seed Shape

The public seed lives at `docs/data/historical-outcomes-seed.yaml`. It is a
human-authored YAML list. Each entry maps closely to an outcome schema v0.1
event, with two backfill-only metadata fields:

```yaml
- incident_id: claude-cache-stale-2025q4
  ts: '2025-11-15T00:00:00Z'
  ts_confidence: estimated
  verb: live_check
  surface: claude_plugin
  outcome: failure
  failure_category: stale_cache
  failure_driver: cache
  plugin: agent-trigger-kit
  note: 'A Claude plugin cache held a removed skill after an upstream update.'
```

Backfill-only fields:

- `incident_id`: required stable slug used only to mint the deterministic UUID.
- `ts_confidence`: required enum, `exact`, `estimated`, or `unknown`.

Schema fields copied into the emitted record:

- Required in seed: `ts`, `surface`, `outcome`.
- Required unless inferred: `verb`.
- Required when `outcome: failure`: `failure_category`.
- Optional: `failure_driver`, `plugin`, `error_code`, `project_hash`, `note`.

If `verb` is absent, the script emits `verb: "manual_record"`. If `surface` is
not known, the seed must use `surface: external`. The script does not invent
failure categories; `outcome: failure` requires `failure_category` in the seed.

### .local.yaml Override Pattern

The public seed is sanitized and intended to be committed. A private seed may
exist at `docs/data/historical-outcomes-seed.local.yaml`. The local seed is for
high-resolution baseline entries that should not be published.

Script input selection is:

1. If `docs/data/historical-outcomes-seed.local.yaml` exists, read it.
2. Otherwise read `docs/data/historical-outcomes-seed.yaml`.

The implementation must add `docs/data/historical-outcomes-seed.local.yaml` to
`.gitignore` before supporting the local override. The local file has the same
shape as the public seed.

### Sanitization Policy

The public seed must not include client names, internal repository paths,
machine usernames, prompt content, file contents, secrets, PII, or high-detail
incident notes that expose private operations.

Public notes should preserve the failure signal while staying generic, for
example:

```yaml
note: 'A Claude plugin used by an internal team observed stale cache after an upstream merge.'
```

Private detail belongs only in `historical-outcomes-seed.local.yaml`.

## Backfill Record Mapping

### Verb, Surface, And Timestamp

Backfilled rows become `kind: "event"` records. Backfill is a human historical
event entry, not a human re-evaluation of an existing event. Therefore it is
not a `kind: "mark"` record.

Mapping rules:

- `schema_version` is always `"0.1"`.
- `kind` is always `"event"`.
- `id` is minted deterministically from `incident_id` and `ts`.
- `ts` is copied from the seed and must be UTC ISO8601 ending in `Z`.
- `verb` is copied from the seed or defaults to `manual_record`.
- `surface` is copied from the seed.
- `outcome` is copied from the seed.
- `failure_category` is copied only when `outcome` is `failure`.
- `failure_driver`, `plugin`, `project_hash`, `error_code`, and `note` are
  copied when present.
- `exit_code` is not emitted. Historical entries are manual events, even when
  `verb` records the operation that originally exposed the incident.
- `duration_ms`, `correlation_id`, and `related_id` are not emitted in v0.1.

The emitted object is validated with `validateRecord(obj)` after removing
`incident_id` and `ts_confidence`.

### UUID v7 Deterministic Mint

Backfilled records need UUID v7 ids whose embedded timestamp matches the
historical `ts`. Using `Date.now()` would make old incidents sort as current
events in tools that use UUID order.

The implementation adds an exported helper such as:

```text
mintUuidV7(date, entropySeed)
```

The helper uses the timestamp bits from `date` and fills the UUID v7 entropy
bits from a SHA-256 hash of `incident_id`. The same `incident_id` and `ts`
therefore produce the same UUID across runs.

Editing an existing seed entry's `ts` after backfill produces a different
deterministic UUID. The previous record remains in the JSONL store; remove it
manually if the historical correction should replace the original.

This deterministic mode is only for backfill. Auto-emitted and manual live
records keep using random entropy so normal recorder ids remain collision
resistant across concurrent writes.

The helper belongs with recorder identity creation, not with schema validation.
`outcome-schema.mjs` validates UUID v7 shape; `outcome-recorder.mjs` or a
small identity helper owns UUID generation.

### Failure Category Requirement Enforcement

The seed loader checks schema rules before writing:

- `outcome: failure` requires `failure_category`.
- Non-failure outcomes must not include `failure_category`.
- Any present `failure_driver` must be a v0.1 enum value.
- The compact emitted JSON record must stay under the 1024-byte schema cap.

Invalid seed entries fail the entire run. The script must not write partial
records when any entry is invalid.

## Idempotency Model

Backfill idempotency uses deterministic UUIDs. The script reads the selected
outcome store before writing and builds a set of existing record ids. If the
deterministic id for a seed entry already exists, the entry is skipped.

The script does not store `incident_id` in the v0.1 record because the schema
has no incident field and unknown fields are invalid. It also does not overload
`error_code`, `correlation_id`, or `note` for idempotency. The UUID is the only
dedupe key.

Re-running the same seed should report zero new records and leave the JSONL
file unchanged except for normal retention behavior already owned by the
recorder.

## Script Behaviour

### Atomic Write Semantics

The one-shot script is `scripts/backfill-historical-outcomes.mjs`. It is not
exposed as a top-level CLI verb. `package.json` adds:

```json
"ops:backfill-outcomes": "node scripts/backfill-historical-outcomes.mjs"
```

The script defaults to `--root .` and user-level outcome storage, matching the
recorder's default store. It may accept `--root <path>` and `--store
user|project` for tests and local operator control, but the npm script uses the
default user-level store.

The script validates every selected seed entry before writing any record. If
any entry fails YAML parsing, seed-shape validation, schema validation, or
duplicate-id detection within the seed file, the script exits non-zero and
does not modify `events.jsonl`.

After validation succeeds, the script writes only entries whose deterministic
ids are not already present in the store. Existing records are preserved.

### Validation Pipeline

The script pipeline is:

1. Resolve `--root` or default to `process.cwd()`.
2. Select `.local.yaml` if present, else public seed.
3. Parse YAML with the existing `yaml` dependency.
4. Validate seed shape constraints, including required fields, enum values,
   non-empty strings, and well-formed `ts`.
5. Mint deterministic UUID v7 ids from `ts` and `incident_id`.
6. Remove backfill-only fields and build schema v0.1 event records.
7. Validate each emitted record with `validateRecord(obj)`.
8. Read existing outcome records and skip ids already present.
9. Append new records through the recorder write path.
10. Print a short summary, including selected seed path, total entries, skipped
    entries, and newly written entries.

The sanitization policy from §3.3 is the seed author's responsibility. The
script does not attempt mechanical PII or internal-reference detection.

### Failure Modes

Expected failures:

- Seed file missing.
- YAML parse error.
- Seed root is not a list.
- Duplicate `incident_id` within the selected seed.
- Invalid `ts` or `ts_confidence`.
- Invalid schema enum value.
- Missing `failure_category` for a failure.
- Non-failure entry includes `failure_category`.
- Emitted record fails `validateRecord`.
- Outcome store cannot be created or written.

Validation failures exit `2`. Store write failures exit `1`. A successful run
with zero new records exits `0`.

## Tests

Add `tests/backfill-historical-outcomes.test.mjs` with fixture roots and homes.
Required coverage:

- A YAML seed writes schema-valid v0.1 event records to `events.jsonl`.
- Re-running the same seed writes zero new records.
- A broken seed entry exits non-zero and writes no records.
- `.local.yaml` is preferred over the public seed when both exist.
- Deterministic UUID v7 ids are stable for the same `incident_id` and `ts`.
- Non-failure entries with `failure_category` are rejected.
- Failure entries without `failure_category` are rejected.

Tests should avoid committing real private incident details. Fixture seed
entries use generic names and notes.

## Impact On Existing Code

Implementation touches:

- `scripts/backfill-historical-outcomes.mjs`: new one-shot script.
- `scripts/lib/outcome-recorder.mjs` or a new small identity helper: exported
  deterministic UUID v7 minting for backfill.
- `package.json`: add `ops:backfill-outcomes`.
- `.gitignore`: ignore `docs/data/historical-outcomes-seed.local.yaml`.
- `docs/data/historical-outcomes-seed.yaml`: public sanitized seed.
- `tests/backfill-historical-outcomes.test.mjs`: script coverage.

The existing `agent-trigger-kit outcome record`, `mark`, and `report` CLI
surface does not change.

## Deferred To Next Iteration

- Mark-style historical reclassification for misroute refinements.
- Schema v0.2 incident metadata or explicit seed provenance fields.
- Automatic incident discovery from git history, GitHub issues, or changelog
  notes.
- Report polish for baseline-vs-new comparisons.
- Dashboard views over historical backfill data.
- Timezone inference for ambiguous historical dates.

## Open Questions

- Should the first public seed include one sanitized example per known incident
  category, or only the minimum examples needed to prove the pipeline?
- Should v0.2 support additive selection that merges the public seed and
  `.local.yaml`, instead of the v0.1 exclusive override?
- Should v0.2 add explicit seed provenance once real backfill usage shows which
  provenance fields are worth preserving?
- Should a dry-run flag be added after the first real seed exposes whether
  preview output is useful?
