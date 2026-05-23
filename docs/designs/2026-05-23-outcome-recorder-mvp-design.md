status: v0.1-draft
date: 2026-05-23
primary_hypothesis: propagation-reliability
invalidates_when: recorder schema v2 appears, automated misroute-detection MVP lands, or MVP auto-emit coverage removes validate, live-check, or premerge
see_also: 2026-05-23-cross-agent-trigger-reliability-problem-statement.md

# Outcome Recorder MVP Design

## Decision

Outcome recorder MVP uses a hybrid emission model. `validate`, `live-check`,
and premerge-family checks auto-emit records through a shared library. Manual
CLI verbs exist for explicit records, human marks, and aggregate reports. The
recorder does not change check pass/fail behavior; it records what the check
already decided.

## Scope

This design implements the measurement contract in the problem statement. It
does not restate the full schema, enum list, storage path, retention limit, or
marking rules. Those contracts stay canonical in the problem statement.

The recorder adds one compatible v1 field:

- `outcome`: optional enum, `ok`, `fail`, or `unknown`

Records without `outcome` are treated as `unknown`. Successful auto-emitted
records use `outcome: ok`. Failed auto-emitted records use `outcome: fail`.
Manual records may use `outcome: unknown` when the operator is creating an
event before a human mark exists.

The recorder also adds one compatible v1 correlation field:

- `correlationId`: optional UUID v7 shared by records from the same logical
  command run

`live-check` emits one record per selected surface or assertion row. All records
from the same `live-check` command share one `correlationId`, which lets reports
aggregate command-level latency without nesting probe details in the event
schema.

## Library And CLI Boundary

Create `scripts/lib/outcome-recorder.mjs` as the implementation boundary.

Library responsibilities:

- Compute `projectHash` from the canonical root path.
- Lazily create the selected outcome store.
- Generate UUID v7 `eventId` and `correlationId` values.
- Validate v1 records before append.
- Append single-line JSONL records.
- Apply retention before or after append as one recorder operation.
- Mark existing events by writing `mark` records.
- Return exit code `4` for marks targeting expired or missing event ids.
- Build aggregate report data by failure category, failure driver, plugin,
  surface, operation kind, outcome, and 60-day window.

Expose the library through `agent-trigger-kit outcome <verb>` in
`scripts/cli.mjs`. The CLI is a thin wrapper over the library.

CLI verbs:

```text
agent-trigger-kit outcome record --root <path> --plugin <name> --surface <surface> --operation-kind <kind> [--outcome ok|fail|unknown] [--failure-category <category>] [--failure-driver <driver>]
agent-trigger-kit outcome mark --root <path> <event-id> --result success|failed|misroute [--failure-category <category>] [--failure-driver <driver>] [--reason <text>]
agent-trigger-kit outcome report --root <path> [--json] [--window-days 60]
```

`outcome record` is for manual evidence only. The three auto-emit entrypoints
call the library directly instead of shelling out to the CLI.

Manual `outcome record` requires `--plugin`. Auto-emitters derive the plugin
from their existing plugin argument, matrix row, or command default.

## Mark Semantics

`outcome mark --result success` writes a success mark without
`failureCategory` or `failureDriver`. If either failure field is supplied with a
success mark, the CLI exits `2`.

`outcome mark --result failed` and `outcome mark --result misroute` require both
failure fields. Reports exclude success marks from failure-category and
failure-driver aggregations.

## Auto-Emit Coverage

MVP auto-emits from three entrypoint families:

| Entrypoint                        | Script                                                                         | Emits In MVP | Notes                                                 |
| --------------------------------- | ------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------- |
| `validate`                        | `scripts/validate-trigger-layer.mjs`                                           | yes          | Static source-tree and generated-surface checks.      |
| `live-check`                      | `scripts/live-trigger-surface-check.mjs`                                       | yes          | One event per selected live surface or assertion row. |
| premerge family                   | `scripts/premerge-version-check.mjs` and `scripts/check-scratch-namespace.mjs` | yes          | Version reconciliation and scratch namespace checks.  |
| clean dry-run                     | `scripts/clean-generated-trigger-layer.mjs`                                    | no           | Known gap for orphan cleanup evidence.                |
| standalone installed-state probes | `scripts/lib/plugin-state-probe.mjs` direct callers                            | no           | Probe results are recorded only through `live-check`. |

## Emission Control

Auto-emission is enabled by default. Any auto-emitting entrypoint skips outcome
recording when `AGENT_TRIGGER_KIT_OUTCOME_DISABLED=1` is present or when the
entrypoint receives `--no-outcome`.

The disable switch affects auto-emission only. Direct
`agent-trigger-kit outcome <verb>` calls still run because they are explicit
recorder commands.

## Validate Emission Mapping

`validate` emits one command-level event. It does not emit one event per
individual validation failure.

| Condition                                                                                                         | outcome | failureCategory      | failureDriver | operationKind  | surface |
| ----------------------------------------------------------------------------------------------------------------- | ------- | -------------------- | ------------- | -------------- | ------- |
| Validation passes                                                                                                 | `ok`    | `unknown`            | `other`       | `static_check` | `repo`  |
| Generated wrapper, command, manifest, Cursor rule, checksum, frontmatter, or generated Markdown drift is reported | `fail`  | `surface_drift`      | `propagation` | `static_check` | `repo`  |
| Required version bump check reports plugin-visible diff without aligned bump                                      | `fail`  | `release_policy_gap` | `propagation` | `static_check` | `repo`  |
| Matrix or header-check config is invalid                                                                          | `fail`  | `unknown`            | `other`       | `static_check` | `repo`  |
| Validator throws or exits before classifying failures                                                             | `fail`  | `unknown`            | `other`       | `static_check` | `repo`  |

When multiple validation failures occur, the emitted event uses the first
matching row in the table order.

Composite validation failures are therefore lower-bound evidence for later
rows. If one run has both surface drift and release policy failures,
`release_policy_gap` is undercounted until a human mark refines the event.

## Live-Check Emission Mapping

`live-check` emits one event per selected surface or assertion result. All
events from the same command share one `correlationId`.

| Result                                                  | outcome | failureCategory                      | failureDriver | operationKind | surface                                     |
| ------------------------------------------------------- | ------- | ------------------------------------ | ------------- | ------------- | ------------------------------------------- |
| `clean`                                                 | `ok`    | `unknown`                            | `other`       | `live_check`  | Result row surface or `repo` for assertions |
| `allowed-drift`                                         | `ok`    | `surface_drift`                      | `propagation` | `live_check`  | Result row surface or `repo` for assertions |
| `drift` from `codex-cache` or `claude-installed-plugin` | `fail`  | `cache_stale` or `version_mismatch`  | `propagation` | `live_check`  | Result row surface                          |
| `drift` from `codex-config-absence`                     | `fail`  | `surface_residue`                    | `propagation` | `live_check`  | `codex`                                     |
| `drift` from `pointer-doc` or `static-validator` row    | `fail`  | `surface_missing` or `surface_drift` | `propagation` | `live_check`  | Result row surface                          |
| `validation-error`, `config-error`, or `timeout`        | `fail`  | `unknown`                            | `other`       | `live_check`  | Result row surface or `repo` for assertions |

If a result has no row surface, the recorder uses `surface: repo`.

## Premerge Emission Mapping

Premerge-family scripts emit one command-level event per script invocation.

| Entrypoint                 | Condition                                                | outcome | failureCategory      | failureDriver | operationKind | surface |
| -------------------------- | -------------------------------------------------------- | ------- | -------------------- | ------------- | ------------- | ------- |
| `premerge-version-check`   | All checks pass                                          | `ok`    | `unknown`            | `other`       | `mutation`    | `repo`  |
| `premerge-version-check`   | Source versions differ                                   | `fail`  | `version_mismatch`   | `propagation` | `mutation`    | `repo`  |
| `premerge-version-check`   | Base reconciliation fails                                | `fail`  | `release_policy_gap` | `propagation` | `mutation`    | `repo`  |
| `premerge-version-check`   | Changelog head does not match source version             | `fail`  | `release_policy_gap` | `propagation` | `mutation`    | `repo`  |
| `premerge-version-check`   | Plugin-visible diff lacks required version bump          | `fail`  | `release_policy_gap` | `propagation` | `mutation`    | `repo`  |
| `check-scratch-namespace`  | No tracked scratch files                                 | `ok`    | `unknown`            | `other`       | `mutation`    | `repo`  |
| `check-scratch-namespace`  | Tracked scratch files found in blocking mode             | `fail`  | `release_policy_gap` | `propagation` | `mutation`    | `repo`  |
| Any premerge-family script | Script cannot inspect git or parse required source state | `fail`  | `unknown`            | `other`       | `mutation`    | `repo`  |

`check-scratch-namespace --advisory` emits `outcome: ok` when it exits `0`, even
when it prints warning annotations.

## Event Identity

Each new event uses UUID v7. UUID v7 provides time ordering without embedding
project names, paths, plugin names, file names, or prompt content.

Each auto-emitted command invocation creates one UUID v7 `correlationId`.
Command-level emitters reuse it for their single event. `live-check` reuses it
for all per-row events from the same invocation.

## Write And Initialization Strategy

The recorder uses lazy init. The first write creates the outcome directory and
the JSONL file if they do not exist. Project-local storage, when selected,
creates the outcome `.gitignore` before the first write.

MVP assumes single-process writes per outcome file. Appends are single-line
JSONL records kept under 1 KB by validation. Parallel writes to the same
project outcome file are a known limitation in MVP and can produce line tearing
on platforms without atomic append guarantees. The implementation must reject a
record whose serialized line exceeds 1 KB before writing.

## Known Gaps

- PR-5 remains human-labeled only because MVP has no automated discovery
  detector.
- PR-10 remains human-labeled only unless it is detected through `validate`.
  `clean-generated-trigger-layer.mjs` does not auto-emit in MVP, so orphan
  cleanup evidence can be undercounted.
- Success events increase JSONL volume. Retention from the problem statement is
  the volume control; no sampling is part of MVP.

## Done Definition

- `scripts/lib/outcome-recorder.mjs` can append valid v1 `event` records with
  `outcome` and optional `correlationId`.
- `agent-trigger-kit outcome record` writes a manual event to the default
  user-level store.
- `agent-trigger-kit outcome mark` writes a mark for an existing event id.
- `agent-trigger-kit outcome mark` exits `4` for an expired or missing event id.
- `agent-trigger-kit outcome report --json` aggregates by `failureDriver`.
- `validate` auto-emits one event per invocation.
- `live-check` auto-emits one event per selected surface or assertion row and
  shares a `correlationId` across the invocation.
- `premerge-version-check` auto-emits one event per invocation.
- `check-scratch-namespace` auto-emits one event per invocation.
- The recorder creates the default outcome store lazily.
- Project-local storage creates `.agent-trigger-kit/outcomes/.gitignore`.
- Serialized JSONL records over 1 KB are rejected before append.
- Existing check exit codes are unchanged by successful recording.
- `AGENT_TRIGGER_KIT_OUTCOME_DISABLED=1` and `--no-outcome` disable
  auto-emission.
- Recorder errors never alter auto-emitting check exit codes in either
  direction. Auto-emitter recorder errors write to stderr and skip the record.
- Direct `agent-trigger-kit outcome <verb>` calls return recorder-specific exit
  codes.
