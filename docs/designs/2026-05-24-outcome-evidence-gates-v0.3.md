status: v0.3-design
date: 2026-05-24
primary_hypothesis: propagation-reliability
invalidates_when: schema v0.2 gate fields are accepted, gate-level reporting ships with materially different denominator semantics, or marked-event data proves the ECC repetition key is too broad or still too sparse
see_also: 2026-05-23-cross-agent-trigger-reliability-problem-statement.md, 2026-05-23-graphify-ecc-safety-integration-positions.md, 2026-05-23-outcome-event-schema-v0.1.md, 2026-05-23-outcome-report-polish.md

# Outcome Evidence Gates v0.3 Design Pass

## Summary

The v0.3 outcome evidence gate pass normalizes the measurement rules for the
Graphify, ECC-style rule suggestion, and Safety re-evaluation gates without
turning those gates into runtime integrations.

This pass makes four decisions:

- A rolling gate window is anchored on the base event `ts`.
- Graphify, ECC, and Safety keep separate denominator families.
- ECC repetition candidates use a 3-tuple key:
  `failure_category + plugin + surface`.
- Gate aggregation is exposed only through `outcome report --gates --json`.

The existing report's default human output stays unchanged. Gate output is an
explicit JSON reader surface for dashboards, release review, and later
automation.

## Non-Goals

This design does not implement Graphify, ECC, runtime safety enforcement, a
dashboard, schema v0.2, new schema field names, migration tooling, or human
gate output. It also does not update existing docs from old measurement
vocabulary to schema v0.1 vocabulary; that cleanup is a prerequisite chore so
reviewers can separate mechanical alignment from gate semantics.

## Prerequisites

Two pieces should land before gate implementation begins.

### Vocabulary Alignment Chore

The positions and problem-statement docs still contain pre-v0.1 vocabulary such
as camelCase field names and `operationKind`. Schema v0.1 intentionally renamed
the old operation-kind axis to `verb`; there is no `operation_kind` replacement
field. A prerequisite docs-only chore should update those references to schema
v0.1 terms or mark them as historical vocabulary.

This chore should not change gate thresholds or report behavior.

### Recorder Translation Audit

Recorder callers still pass camelCase option names such as `failureCategory`
and `failureDriver`, while the JSONL schema stores snake_case fields. The
recorder translation layer currently accepts both forms. Gate reporting depends
on that normalization being correct because a missed translation silently
changes counts.

Before v0.3 gate implementation, audit and test that auto-emitters and manual
commands normalize:

- `failureCategory` to `failure_category`
- `failureDriver` to `failure_driver`
- `exitCode` to `exit_code`
- `durationMs` to `duration_ms`
- `errorCode` to `error_code`
- `correlationId` to `correlation_id`

## Window Anchor

The canonical rolling 60-day gate window is anchored on the base event `ts`.
A gate includes an event when:

```text
window_start <= event.ts <= window_end
```

`window_end` defaults to the report generation time, precise to milliseconds.
It is not truncated to a UTC day boundary. `window_start` defaults to
`window_end - 60 days`. If a future report mode accepts explicit window bounds,
those bounds still filter by event `ts`.

Marks never move an event into or out of a gate window. A mark corrects the
event's effective outcome and taxonomy; it does not change when the underlying
incident, check, or operation happened.

For v0.3 gate reporting, the reader applies the latest retained mark available
at report generation time to any included event. This design does not define a
historical "as-of mark timestamp" replay mode.

## Denominator Families

The three gate denominator families are intentionally different and must not be
compared horizontally. A Graphify denominator, an ECC denominator, and a Safety
denominator answer different questions. Gate output must render each gate as an
independent result with its own numerator, denominator, threshold, and
eligibility state.

| Gate     | Denominator family               | Numerator                                     | Threshold                                        | Eligibility                                                      |
| -------- | -------------------------------- | --------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| Graphify | Marked failure-signal events     | Context-bloat failure-signal events           | At least 3 events or at least 20% of denominator | Denominator has at least 10 marked failure-signal events         |
| ECC      | All marked events                | Largest repeated failure 3-tuple count        | At least 5 events with same repetition key       | Denominator has at least 20 marked events                        |
| Safety   | Marked mutation or safety events | Release-policy or surface-residue safety hits | At least 3 events                                | Schema supports mutation or safety denominator; not true in v0.1 |

Definitions:

- A "marked event" is an event with at least one schema-valid mark whose
  `related_id` points at that event.
- The latest retained mark determines the event's effective gate taxonomy.
- A "failure-signal event" is a marked event whose effective `outcome` is
  `failure`. Schema v0.1 represents misroutes as
  `failure_category: "misroute"` on failed events.
- `skipped` events do not contribute to any gate numerator. They contribute to
  the ECC denominator only if they are marked, because ECC measures whether
  enough human-reviewed evidence exists for rule suggestion.

ECC intentionally has two populations:

- The eligibility denominator is all marked events, including marked `success`,
  `failure`, `blocked`, and `skipped` events. This measures review adoption.
- The candidate pool is only marked failure events with a schema-valid
  `failure_category`. This measures rule-suggestion repetition.

Marked skipped events can make ECC eligible by proving review volume, but they
cannot create or increase a repeated failure candidate. Gate JSON must expose
both the denominator and candidate counts so reviewers can see when ECC is
eligible because of review effort rather than failure volume.

## Gate Status Values

Gate JSON uses one status axis:

- `disabled`: v0.1 cannot honestly evaluate the gate, or the caller disabled
  gate evaluation.
- `insufficient_data`: the gate can be evaluated but the denominator does not
  meet eligibility.
- `not_triggered`: the denominator is eligible and the numerator is below the
  threshold.
- `triggered`: the denominator is eligible and the numerator meets the
  threshold.

Disabled gates must include `disabled_reason`. Insufficient-data gates must
include the missing denominator count.

Disabled gate denominators are intentionally asymmetric. When the denominator
family can still be measured under schema v0.1, the report includes that
denominator even if the numerator axis is missing. When the denominator family
itself depends on a missing schema axis, the denominator is `null` and the gate
may expose diagnostic partial counts instead.

## Graphify Gate

Graphify asks whether context bloat has become a major enough failure driver to
reopen graph-context work.

Schema v0.1 cannot honestly evaluate this gate because `failure_driver` is a
responsibility-domain enum (`human`, `tooling`, `cache`, `network`, `config`,
`unknown`). It cannot represent `context_bloat` without overloading the field.

The v0.3 report therefore emits Graphify as `disabled` by default:

```json
{
  "status": "disabled",
  "disabled_reason": "schema_gap.context_bloat_axis_missing",
  "denominator_family": "marked_failure_signal_events",
  "denominator": 12,
  "numerator": null,
  "threshold": {
    "minimum_count": 3,
    "minimum_share": 0.2
  }
}
```

This is an explicit limitation, not a silent pass. The gate can be enabled only
after a separate schema design defines how to represent context-bloat evidence
and marked-event data proves that the extra axis is needed.

## ECC Repetition Gate

ECC-style rule suggestion asks whether repeated human-reviewed failures point
to a concrete rule candidate.

The v0.2 position used a strict 4-tuple:

```text
failure_category + failure_driver + plugin + surface
```

That key is too sparse for expected early outcome volume. v0.3 uses this
primary key instead:

```text
failure_category + plugin + surface
```

`failure_driver` remains a breakdown inside each candidate. It is not part of
the primary repetition key.

### ECC Candidate Example

Suppose the 60-day window contains these two marked failed events:

| failure_category | plugin | surface       | failure_driver |
| ---------------- | ------ | ------------- | -------------- |
| stale_cache      | foo    | claude_plugin | cache          |
| stale_cache      | foo    | claude_plugin | tooling        |

The v0.2 4-tuple would produce two one-off candidates and no repeated signal.
The v0.3 3-tuple produces one repeated candidate:

```json
{
  "key": {
    "failure_category": "stale_cache",
    "plugin": "foo",
    "surface": "claude_plugin"
  },
  "count": 2,
  "failure_driver_breakdown": {
    "cache": 1,
    "tooling": 1
  },
  "driver_policy": "wildcard",
  "rule_suggestion_basis": "Repeated stale_cache failures for plugin foo on claude_plugin regardless of driver; inspect driver breakdown before writing a narrow rule."
}
```

The gate does not emit two separate rule suggestions just because drivers
differ. It emits one wildcard-driver candidate and keeps the driver breakdown
auditable. If a later dataset shows that wildcard grouping hides distinct
remediation paths, the ECC key can be revisited with evidence.

## Safety Gate

Safety asks whether trigger-admission controls need to move beyond advisory
validation and reports.

Schema v0.1 cannot honestly evaluate the current Safety denominator because the
old gate depends on `operationKind: mutation`, and schema v0.1 renamed that
axis to `verb` rather than preserving mutation scope. `verb` values such as
`premerge_version_check` and `scratch_namespace_check` do not prove that the
underlying event was a mutation attempt.

The v0.3 report therefore emits Safety as `disabled` by default:

```json
{
  "status": "disabled",
  "disabled_reason": "schema_gap.mutation_axis_missing",
  "denominator_family": "marked_mutation_or_safety_events",
  "denominator": null,
  "numerator": null,
  "threshold": {
    "minimum_count": 3
  },
  "auditable_partial_counts": {
    "release_policy_gap_failures": 2,
    "surface_residue_failures": 1
  }
}
```

The partial counts are diagnostic only. They must not be treated as a passed or
failed Safety gate because they lack the mutation/safety denominator.

## Gate Report JSON

Gate aggregation belongs behind an explicit JSON-only mode:

```text
agent-trigger-kit outcome report --root <path> --gates --json
```

If `--gates` is supplied without `--json`, the command exits `2` with a short
message explaining that gate summaries are JSON-only. The default human report
does not include gate results.

Existing report filters apply before gate aggregation. A filtered gate measures
only that sub-population; for example, `--surface claude_plugin` evaluates the
Graphify, ECC, and Safety gates only for effective events on
`surface: "claude_plugin"`. Filtered gate results must not be compared to
unfiltered gate results without naming the filter.

`gate_report_version` is independent from `report_version`. Bump
`gate_report_version` when the gate JSON shape, thresholds, denominator
families, status semantics, or repetition-key semantics change. Bump
`report_version` only when the non-gate report contract changes.

The JSON shape extends the existing report object with a gate section:

```json
{
  "schema_version": "0.1",
  "report_version": "0.1",
  "gate_report_version": "0.1",
  "generated_at": "2026-05-24T10:15:30.000Z",
  "scope": {
    "since": "2026-03-25T10:15:30.000Z",
    "surface": null,
    "verb": null,
    "retained_records_only": true
  },
  "gates": {
    "window": {
      "anchor": "event_ts",
      "days": 60,
      "start": "2026-03-25T10:15:30.000Z",
      "end": "2026-05-24T10:15:30.000Z",
      "mark_policy": "latest_retained_mark_at_report_time"
    },
    "marked_event_counts": {
      "marked_events": 22,
      "marked_failures": 11,
      "marked_skipped": 1,
      "unmarked_events": 38
    },
    "graphify": {
      "status": "disabled",
      "disabled_reason": "schema_gap.context_bloat_axis_missing",
      "denominator_family": "marked_failure_signal_events",
      "denominator": 11,
      "numerator": null,
      "threshold": {
        "minimum_count": 3,
        "minimum_share": 0.2
      }
    },
    "ecc": {
      "status": "not_triggered",
      "denominator_family": "all_marked_events",
      "denominator": 22,
      "numerator": 2,
      "candidate_pool": 11,
      "threshold": {
        "minimum_repeated_count": 5
      },
      "repetition_key": ["failure_category", "plugin", "surface"],
      "top_candidates": [
        {
          "key": {
            "failure_category": "stale_cache",
            "plugin": "foo",
            "surface": "claude_plugin"
          },
          "count": 2,
          "failure_driver_breakdown": {
            "cache": 1,
            "tooling": 1
          },
          "driver_policy": "wildcard"
        }
      ]
    },
    "safety": {
      "status": "disabled",
      "disabled_reason": "schema_gap.mutation_axis_missing",
      "denominator_family": "marked_mutation_or_safety_events",
      "denominator": null,
      "numerator": null,
      "threshold": {
        "minimum_count": 3
      }
    },
    "diagnostics": {
      "schema_gaps": [
        "graphify requires a context-bloat evidence axis not present in schema v0.1",
        "safety requires a mutation or safety denominator not present in schema v0.1"
      ],
      "prerequisites": [
        "docs vocabulary alignment from pre-v0.1 terms to schema v0.1 terms",
        "recorder translation audit for camelCase caller options to snake_case records"
      ]
    }
  }
}
```

The gate section is mark-corrected. A marked event contributes once, using the
latest retained mark. Marks themselves do not add extra denominator rows.

## Schema Gap Policy

v0.3 may identify schema gaps but must not freeze v0.2 field names or enum
values. A future schema v0.2 design is required before enabling any gate whose
query would otherwise lie under v0.1.

The rule is:

1. Name the exact gate query that cannot be evaluated under v0.1.
2. Disable that gate by default and emit a machine-readable disabled reason.
3. Defer field names, enum names, and compatibility rules to a separate schema
   design after marked-event data proves the gap matters.

## Implementation Notes For Later

Implementation should use TDD and keep the current default report behavior
unchanged.

Expected tests:

- `outcome report --gates --json` includes only events whose base event `ts` is
  inside the rolling window.
- The window end equals the report generation timestamp to millisecond
  precision; it is not rounded to a UTC day.
- A mark outside the event window does not move an outside event into the
  window.
- A mark for an event inside the window changes the effective taxonomy even
  though the event keeps its original `ts`.
- `--surface` and `--verb` filters apply before gate aggregation and produce a
  filtered sub-population.
- Graphify emits `disabled` with
  `schema_gap.context_bloat_axis_missing` under schema v0.1.
- Safety emits `disabled` with `schema_gap.mutation_axis_missing` under schema
  v0.1.
- ECC groups repeated candidates by
  `failure_category + plugin + surface` and exposes
  `failure_driver_breakdown`.
- The ECC example with two `stale_cache/foo/claude_plugin` events and different
  drivers produces one wildcard-driver candidate, not two independent rule
  candidates.
- `--gates` without `--json` exits `2`.
- Existing `outcome report` human output remains unchanged when `--gates` is
  absent.

## Review Notes

This design intentionally leaves existing positions and problem-statement docs
in place until the prerequisite vocabulary chore. Reviewers should judge this
document's gate semantics separately from the mechanical cleanup needed to make
older docs use schema v0.1 terms.
