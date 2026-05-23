status: v0.1-draft
date: 2026-05-23
primary_hypothesis: propagation-reliability
invalidates_when: recorder schema v0.2 changes required fields, v0.1 additive-only compatibility is rejected, or a registry MVP requires task-level routing identity in every record
see_also: 2026-05-23-cross-agent-trigger-reliability-problem-statement.md, 2026-05-23-outcome-recorder-mvp-design.md

# Outcome Event Schema v0.1

## Context And Scope

Outcome recorder MVP proved the write path, manual mark path, aggregate report
path, and auto-emission coverage for `validate`, `live-check`, premerge version
checks, and scratch namespace checks. This design narrows the record contract so
later report, dashboard, and backfill work can consume one stable JSONL stream
without reverse-engineering recorder implementation details.

Schema v0.1 is the canonical shape for new outcome records after this design is
implemented. It supersedes the recorder MVP's implementation-shaped fields such
as `eventId`, `recordType`, `recordedAt`, `operationKind`, `failureCategory`,
and `failureDriver`.

## Non-Goals

This design does not implement migrations from the MVP schema, export a JSON
Schema artifact, add a schema-version dispatcher, add registry-backed routing
identity, or define dashboard UI. It also does not add a free-form `meta` object.
Every v0.1 field is explicitly named.

## Record Shape

Each record is one JSON object on one JSONL line. The top-level shape is closed:
unknown fields are invalid in v0.1.

| Field              | Type             | Requirement | Notes                                              |
| ------------------ | ---------------- | ----------- | -------------------------------------------------- |
| `id`               | UUID v7 string   | required    | Stable record id.                                  |
| `schema_version`   | string           | required    | Must be `"0.1"`.                                   |
| `kind`             | enum             | required    | `event` or `mark`.                                 |
| `ts`               | UTC ISO8601      | required    | Must end in `Z`.                                   |
| `verb`             | enum             | required    | What was checked or marked.                        |
| `outcome`          | enum             | required    | Top-level result axis.                             |
| `surface`          | enum             | required    | Surface checked or affected by the record.         |
| `exit_code`        | integer          | conditional | Required for auto-emitted events, forbidden marks. |
| `duration_ms`      | non-negative int | optional    | Elapsed time measured by the recorder.             |
| `failure_category` | enum             | conditional | Required only when `outcome` is `failure`.         |
| `failure_driver`   | enum             | optional    | Root responsibility domain when known.             |
| `error_code`       | string           | optional    | Short stable token, not a raw message.             |
| `project_hash`     | string           | optional    | First 12 SHA-256 hex chars of canonical root path. |
| `plugin`           | string           | optional    | Plugin name when known.                            |
| `correlation_id`   | UUID v7 string   | optional    | Shared by one command run and its child records.   |
| `related_id`       | UUID v7 string   | optional    | 1:1 link, primarily mark to event.                 |
| `note`             | string           | optional    | Human note; whole serialized record stays <= 1 KB. |

`id`, `correlation_id`, and `related_id` use UUID v7 so records remain
time-sortable without embedding file paths, project names, prompt content, or
task text.

## Enum Value Definitions

### Verb

`verb` describes what was checked or marked. It does not describe whether the
record is an event or a mark; `kind` owns that axis.

- `validate`: static trigger-layer validation.
- `live_check`: live trigger surface or assertion check.
- `premerge_version_check`: source-visible version reconciliation before merge.
- `scratch_namespace_check`: scratch namespace release gate or advisory.
- `manual_record`: explicit human-created event through the recorder CLI.

Marks reuse the original event's verb. A human mark for a validate event uses
`kind: "mark"` and `verb: "validate"`, not `verb: "mark"`.

### Outcome

`outcome` is the small, stable result axis.

- `success`: the operation or mark succeeded.
- `failure`: the operation or mark found an incorrect or unhealthy state.
- `skipped`: the operation intentionally did not perform work.
- `blocked`: the operation stopped because a gate intentionally prevented
  progress.

Misroutes are represented as `outcome: "failure"` with
`failure_category: "misroute"`. They are not a separate outcome value because
v0.1 keeps process result and failure taxonomy separate.

### Surface

`surface` is the surface being checked or affected, not the entrypoint used to
run the check.

- `repo`: repository-level trigger-layer state.
- `cli`: Agent Trigger Kit command-line behavior.
- `codex_plugin`: Codex plugin, marketplace, config, or cache surface.
- `claude_plugin`: Claude plugin, marketplace, install, or cache surface.
- `cursor_rule`: Cursor rule surface.
- `external`: manual, CI, or other evidence outside the known surfaces.

### Failure Category

`failure_category` says what kind of failure occurred: the visible symptom or
artifact dimension.

- `stale_cache`: installed cache or runtime copy lagged behind source.
- `version_skew`: two version sources disagreed.
- `misroute`: a target agent, skill, command, or plugin route was wrong.
- `manifest_drift`: generated manifests, wrappers, commands, or rules drifted.
- `missing_artifact`: an expected generated, installed, or live artifact was
  absent.
- `release_policy_gap`: release policy was violated or a required version bump
  was missing.
- `surface_residue`: stale config, generated files, or orphaned surfaces
  remained after they should have been removed.
- `unknown`: failure was observed but not classified.

`failure_category` is required when `outcome` is `failure`; use `unknown` rather
than omitting the field.

### Failure Driver

`failure_driver` says why the failure happened: the root responsibility domain
when it is known.

- `human`: human operation, review, or marking mistake.
- `tooling`: Agent Trigger Kit or companion tooling behavior.
- `cache`: cache lifecycle or propagation lag.
- `network`: network, fetch, clone, or remote availability.
- `config`: local or project configuration.
- `unknown`: driver is not known yet.

`failure_driver` is optional in v0.1 because an auto-emitted event often knows
the symptom before a human has determined the driver. A combination such as
`failure_category: "stale_cache"` and `failure_driver: "cache"` is valid but
low-signal; the driver should answer the responsibility question when possible.

## Cross-Validation Rules

`failure_category` is forbidden unless `outcome` is `failure`. It must be absent
for `success`, `skipped`, and `blocked`; an empty string is invalid. When
`outcome` is `failure`, `failure_category` is required and may be `unknown`.

`failure_driver` is optional for every outcome. When present, it must be one of
the closed enum values.

`exit_code` is required only for auto-emitted event records whose `verb` is
`validate`, `live_check`, `premerge_version_check`, or
`scratch_namespace_check`. `exit_code` is optional for
`kind: "event", verb: "manual_record"`. `exit_code` is forbidden for
`kind: "mark"`.

`kind: "mark"` records must include `related_id` pointing at the marked event.
The schema validates the UUID shape but does not require the referenced event to
exist during single-record validation.

Marks are never standalone observations. An independent human observation is a
`kind: "event"` record with `verb: "manual_record"`.

The total serialized JSON length after compact encoding must not exceed 1024
bytes. Records over the cap are rejected at write-time. The cap applies to
events, marks, and orphan records alike.

## Recorder Behaviour

Each command run mints one UUID v7 `correlation_id` at the run boundary. A
command-level parent event uses `surface: "repo"`. More precise child records
for Codex, Claude, or Cursor surfaces reuse the same `correlation_id`. The
schema does not enforce that a parent exists for every child because partial
writes, recorder errors, and interruption can produce orphan child records.
Report tooling must tolerate orphan children.

`related_id` is not a parent-child correlation mechanism. It is a 1:1 pointer
from a mark to the event being marked. Manual marks provide `related_id` through
the `outcome mark` command.

A mark's `outcome`, `failure_category`, and `failure_driver` are independent of
the marked event's values. Marks represent human re-evaluation. Report
aggregation should prefer the latest mark over the auto-emitted event when both
exist for the same `related_id`.

Writers always set `schema_version: "0.1"`. Readers reject any record without
that exact schema version. Future-version records are skipped with a schema
error until a dispatcher is implemented.

Parse or validation errors are non-fatal for report readers. A bad JSONL line is
skipped and emits one stderr line:

```text
outcome.schema_error: line=<line-number> reason=<short reason>
```

The reason must be stable and concise. It must not include payload content,
prompt text, file contents, or full exception stacks.

The `note` field is human-authored free-form text. Recorder and CLI surfaces
should warn callers that notes are stored in plaintext and should not contain
prompt content, file contents, secrets, or PII.

## Compatibility Policy

Within v0.x, schema evolution is additive only. Adding a new optional field or
enum value requires a v0.2 schema version. Renaming a field, removing a field,
changing a field's meaning, or changing cross-validation behavior requires
stopping v0.x evolution and moving to v1.0 or a migration plan.

Readers for v0.1 reject unknown fields and future schema versions. This makes
schema drift visible early and prevents silent aggregation against records whose
meaning the reader does not understand.

## Impact On Existing MVP Code

The current recorder MVP writes implementation-shaped v1 records. A follow-up
implementation should add a pure `validateRecord(obj)` function, update the
writer to emit schema v0.1 records, update manual `record` and `mark` CLI verbs,
and update report aggregation to consume only schema v0.1.

Auto-emitter mappings should translate current concepts as follows:

| Current concept                        | Schema v0.1 field                                      |
| -------------------------------------- | ------------------------------------------------------ |
| `recordType`                           | `kind`                                                 |
| `eventId`                              | `id` for events, `related_id` for marks                |
| `recordedAt` or `markedAt`             | `ts`                                                   |
| `operationKind`                        | `verb`                                                 |
| `outcome: ok`                          | `outcome: success`                                     |
| `outcome: fail`                        | `outcome: failure`                                     |
| `failureCategory`                      | `failure_category`                                     |
| `failureDriver`                        | `failure_driver`                                       |
| `correlationId`                        | `correlation_id`                                       |
| `projectHash`                          | `project_hash`                                         |
| direct recorder errors or policy gates | `outcome: blocked` when the record represents the gate |

The implementation should not change existing check exit codes. Recorder errors
remain side-channel stderr diagnostics for auto-emitters.

## Deferred To v0.2 Or Later

Deferred work includes a JSON Schema export, an explicit schema-version
dispatcher, migration tooling for existing MVP records, a free-form metadata
object, registry-backed route identity, multi-tenant project hash semantics,
and dashboard-specific denormalized fields.

Historical incident backfill should use this schema once implemented. Backfill
records can use `verb: "manual_record"` and `surface: "external"` when the
original entrypoint or affected surface is not known.

## Open Questions

No blocking questions remain for v0.1. The first implementation review should
re-check whether `failure_driver` is too coarse after several marked events, and
whether `manifest_drift` and `missing_artifact` should split further in v0.2.
