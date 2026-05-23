status: v0.1-draft
date: 2026-05-23
primary_hypothesis: propagation-reliability
invalidates_when: report users need raw event inspection as the primary workflow, mark-corrected aggregation proves insufficient for hypothesis review, or time-series comparison becomes required before the first 60-day sample closes
see_also: 2026-05-23-cross-agent-trigger-reliability-problem-statement.md, 2026-05-23-outcome-event-schema-v0.1.md, 2026-05-23-outcome-recorder-mvp-design.md, 2026-05-23-outcome-historical-backfill.md

# Outcome Report Polish

## Context And Scope

Outcome recorder MVP already has a minimal `outcome report` path, but its
current human output is only a thin debugging summary. Schema v0.1 and
historical backfill now make the JSONL store useful enough to answer the
problem statement's propagation reliability questions directly.

This design polishes the report reader without turning it into a dashboard. The
v0 report answers three fixed questions:

- What is the current propagation success rate?
- Which surface has the weakest propagation reliability?
- Which failure categories appear most often?

The report remains a CLI reader over the existing outcome JSONL store. It
consumes schema v0.1 records, applies mark overrides before aggregation, and
returns either human-readable text or structured JSON.

## Non-Goals

This design does not add dashboard UI, charts, sparklines, CSV export, Markdown
export, HTML output, color terminal output, cross-tab matrices, time-series
comparison, `--until`, automatic historical backfill, or raw event listing. It
also does not add time-to-detect or time-to-propagate metrics, because those
require event pairing rules that are outside v0.

Debugging raw data remains a JSONL workflow. Operators who need to inspect
individual records can read `events.jsonl` directly with `jq` or another JSONL
tool.

## Report Shape

### Default Human-Readable Output

`agent-trigger-kit outcome report --root <path>` defaults to human-readable
text. The text should be short, stable, and hypothesis-direct:

```text
Outcome report
Project: <project_hash>
Scope: retained records, since <timestamp-or-all>

Propagation reliability
Signal events: 14
Success rate: 71.4% (10 success / 14 success+failure+blocked)
Failures: 3
Blocked: 1
Skipped: 2 (excluded from success-rate denominator)

Surface reliability
surface          signal  success  failure  blocked  skipped  success_rate
repo             7       6        1        0        0        85.7%
claude_plugin    5       3        1        1        1        60.0%

Failure categories
failure_category    count  share_of_failures
stale_cache         2      66.7%
misroute            1      33.3%
```

The exact table spacing can follow local formatter constraints, but the output
must include the three headline answers without requiring the user to mentally
join multiple buckets.

Empty or no-signal reports should stay explicit:

```text
Outcome report
No signal events found for the selected filters.
```

### `--json` Structured Output Schema

`agent-trigger-kit outcome report --root <path> --json` emits a stable JSON
object for future dashboard or automation consumers:

```json
{
  "schema_version": "0.1",
  "report_version": "0.1",
  "generated_at": "2026-05-23T00:00:00.000Z",
  "project_hash": "abc123def456",
  "store": "user",
  "scope": {
    "since": "2026-04-23T00:00:00.000Z",
    "surface": null,
    "verb": null,
    "retained_records_only": true,
    "retention_horizon_days": 90,
    "retention_record_limit": 1000
  },
  "totals": {
    "events_read": 20,
    "marks_read": 3,
    "effective_events": 16,
    "signal_events": 14,
    "skipped_events": 2
  },
  "propagation": {
    "status": "ok",
    "success": 10,
    "failure": 3,
    "blocked": 1,
    "skipped": 2,
    "denominator": 14,
    "success_rate": 0.7143,
    "failure_rate": 0.2143,
    "blocked_rate": 0.0714
  },
  "by_surface": [
    {
      "surface": "repo",
      "signal_events": 7,
      "success": 6,
      "failure": 1,
      "blocked": 0,
      "skipped": 0,
      "success_rate": 0.8571,
      "failure_rate": 0.1429,
      "blocked_rate": 0
    }
  ],
  "by_failure_category": [
    {
      "failure_category": "stale_cache",
      "count": 2,
      "share_of_failures": 0.6667
    }
  ]
}
```

JSON output is mark-corrected aggregation, not a raw event dump. The report may
include input counts such as `events_read` and `marks_read`, but it must not
expose a raw-versus-corrected comparison view in v0.

Top-level count fields mean:

- `events_read`: total schema-valid event records parsed from the selected
  store before report filters.
- `marks_read`: total schema-valid mark records parsed from the selected store
  before report filters.
- `effective_events`: event records after report filters and latest-mark
  override. Bad or future-version JSONL lines are already skipped by the
  reader.
- `signal_events`: effective events with outcome `success`, `failure`, or
  `blocked`.
- `skipped_events`: effective events with outcome `skipped`.

## Aggregation Semantics

### Propagation Rate Formula

The propagation success-rate denominator is:

```text
success + failure + blocked
```

`skipped` is excluded because it represents no-op or intentionally disabled
paths rather than a propagation attempt. `blocked` is included because the
workflow did not complete and is a reliability signal for the trigger layer.
Schema v0.1 does not distinguish drift-driven blocks from healthy
policy-driven blocks, so the headline rate intentionally treats all blocks as
non-success while JSON also exposes `failure_rate` and `blocked_rate`.
Consumers that want a health-only interpretation can split blocked gates from
ordinary failures without changing the record schema.

Formula:

```text
success_rate = success / (success + failure + blocked)
failure_rate = failure / (success + failure + blocked)
blocked_rate = blocked / (success + failure + blocked)
```

If the denominator is zero, `success_rate` is `null` in JSON and the human
output says there is no signal for the selected filters. JSON also sets
`failure_rate` and `blocked_rate` to `null` when the denominator is zero.

### Per-Surface Breakdown

Surface rows use the same denominator rule as the headline propagation rate.
Each row reports:

- `signal_events`: `success + failure + blocked`.
- `success`, `failure`, `blocked`, and `skipped` counts.
- `success_rate`, `failure_rate`, and `blocked_rate`, each using
  `signal_events` as denominator.

Rows are sorted by lowest `success_rate`, then highest `failure + blocked`
count, then surface name. Ties beyond surface name break by deterministic
insertion order from the JSONL stream. This makes weak surfaces appear first
while keeping stable output when counts tie.

### Per-Failure-Category Breakdown

Failure category rows include only effective records whose outcome is
`failure`. Schema v0.1 requires `failure_category` for failures, so every
failure contributes to exactly one category, including `unknown`.

Rows are sorted by descending count, then category name. `share_of_failures` is:

```text
category_count / total_failure_events
```

If there are no failures, JSON emits an empty array and human output says no
failures were found for the selected filters.

### Mark Override

Report aggregation applies the existing schema v0.1 rule: latest mark wins.
For each event, the reader finds the latest retained `kind: "mark"` whose
`related_id` points at the event and uses the mark's outcome, surface,
failure_category, failure_driver, error_code, plugin, and note where relevant
for aggregation.

Marks are human re-evaluation, not extra events. A marked event contributes one
effective event to totals. The mark timestamp records when the correction was
made; the original event timestamp remains the incident timestamp for time
window filtering.

The v0 report exposes only the effective, mark-corrected view. Raw event versus
corrected comparison is deferred to the mark UX iteration.

Marks may override `surface`. Effective events are bucketed by the
mark-corrected surface in the per-surface breakdown, not by the original event
surface.

## CLI Flags

### `--since`

Add:

```text
agent-trigger-kit outcome report --root <path> --since <UTC-ISO8601>
```

`--since` filters base events by event `ts`, inclusive. Marks are looked up for
the retained included events; mark `ts` does not decide whether the base event
belongs in the report window.

The timestamp must parse as UTC ISO8601 ending in `Z`. Invalid timestamps exit
`2`.

The existing `--window-days <n>` option remains accepted for compatibility and
derives `since = now - n days`. Help text should prefer `--since`. If both
`--since` and `--window-days` are provided, `--since` wins so callers can pass a
precise boundary.

`--until` is intentionally deferred to v0.2.

### `--surface` / `--verb` Filters

Add:

```text
agent-trigger-kit outcome report --root <path> --surface <surface>
agent-trigger-kit outcome report --root <path> --verb <verb>
```

Both filters use schema v0.1 enum values and reject unknown values with exit
`2`. Filters are applied after mark override so the report reflects the
mark-corrected truth. `--verb` is effectively stable because marks must match
their related event's verb, but it still follows the same effective-record
pipeline for consistency.

Additional filters, including `--failure-category`, are deferred to v0.2.

### `--json`

`--json` switches output from human text to the structured JSON object defined
above. It does not change aggregation semantics, filters, or exit codes.

## Edge Cases

### Empty Store

An absent `events.jsonl` file is a valid no-signal report. Human output states
that no signal events were found. JSON emits `propagation.status: "no_signal"`,
zero totals, empty breakdown arrays, and `success_rate: null`.

### All-Skipped Store

If every effective event is `skipped`, the report has events but no signal
denominator. Human output should call this out directly. JSON sets
`propagation.status: "no_signal"`, reports the skipped count, and sets
`success_rate: null`.

### Retention-Dropped Records

Reports are snapshots over records currently present in the selected store.
They must not infer missing historical records.

Current live recorder retention is `ts`-based: normal recorder appends retain
valid records whose `record.ts` is within the 90-day retention horizon and keep
at most the newest 1000 retained records. Historical backfill import uses
append-only writes and does not apply retention during import, but later live
recorder writes to the same store can prune older backfilled records by their
historical `ts`.

The v0 report should describe its scope as retained records. If `--since`
requests a boundary older than the live retention horizon, human output may add
a retained-records-only note, and JSON should set
`scope.retained_records_only: true`, `scope.retention_horizon_days: 90`, and
`scope.retention_record_limit: 1000`.

## Tests

Focused report tests should cover:

- Empty store human and JSON no-signal output.
- All-skipped store no-signal denominator.
- Headline propagation formula excludes `skipped` and includes `blocked`.
- Per-surface rows aggregate effective records and sort weak surfaces first.
- Per-failure-category rows count only effective failures and include
  `unknown`.
- Latest mark overrides event outcome and category for aggregation.
- `--since` filters by event `ts` while still applying a later mark.
- `--surface` and `--verb` filters validate enum values and apply after mark
  override.
- `--json` emits the structured shape and no human table text.
- Existing `--window-days` remains accepted, with `--since` taking precedence.
- Retained-records-only scope is represented when the selected window reaches
  beyond the live recorder retention horizon.

## Impact On Existing Code

Expected implementation touch points:

- `scripts/lib/outcome-recorder.mjs`: extend `buildOutcomeReport` with
  `since`, `surface`, and `verb` inputs; return the structured report shape;
  keep mark override centralized.
- `scripts/outcome-recorder.mjs`: parse report flags, validate enum and
  timestamp arguments, format human text, and keep `--json` behavior.
- `tests/outcome-recorder.test.mjs`: replace minimal report assertions with
  hypothesis-direct report cases.
- Help text and README snippets may need small wording updates only if they
  currently document the old report output.

No schema v0.1 changes are required. No backfill migration is required.

## Deferred To v0.2+

- `--until` and cross-window comparison.
- `--failure-category` and broader filter vocabulary.
- Surface by failure-category cross-tab.
- Time-series output, sparklines, or dashboard UI.
- Raw event versus mark-corrected comparison view.
- Time-to-detect and time-to-propagate metrics.
- Markdown, CSV, or HTML export.
- Historical baseline durability must be resolved in v0.2: either add a
  retention-exempt archive store, mark backfill records with a non-prunable flag
  in a schema bump, or add a baseline replay command. The decision deadline is
  before the first 60-day analysis window closes.

## Open Questions

- Should `--window-days` stay indefinitely as a convenience alias, or become
  deprecated once `--since` exists?
- Should `unknown` failure categories be highlighted in human output once the
  sample grows, or remain a normal category until mark UX improves?
