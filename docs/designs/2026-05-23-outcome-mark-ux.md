status: v0.1-draft
date: 2026-05-23
primary_hypothesis: propagation-reliability
invalidates_when: operators still need to inspect raw JSONL for common mark workflows, short-id selection proves unsafe in normal stores, or scripted mark usage requires bulk predicates before interactive triage
see_also: 2026-05-23-cross-agent-trigger-reliability-problem-statement.md, 2026-05-23-outcome-event-schema-v0.1.md, 2026-05-23-outcome-recorder-mvp-design.md, 2026-05-23-outcome-report-polish.md

# Outcome Mark UX

## Context And Scope

Outcome recorder can already write events, write marks, and aggregate reports
with latest-mark override. The remaining blocker is human friction. A mark
requires finding an event id, copying a 36-character UUID v7, and remembering
the right override flags. That friction makes mark-corrected aggregation look
empty even when humans know the ground truth.

This design adds the minimum CLI affordances needed to make marking routine:

- `outcome events` lists recent events with short ids.
- `outcome mark <short-id>` accepts unique UUID prefixes.
- `outcome mark --last` marks the latest unmarked event, optionally filtered by
  verb.
- TTY mode prompts for missing required mark fields without affecting scripted
  non-TTY use.

The feature stays append-only. It does not edit, delete, or rewrite existing
records.

## Non-Goals

This design does not add bulk marking, triage walk mode, web UI, mark editing,
mark deletion, event mutation, report deep-links, fuzzy search, CSV export, or
new schema fields. It also does not change report aggregation semantics:
latest mark for an event still wins.

## New Surface: `outcome events`

Add:

```text
agent-trigger-kit outcome events --root <path> [--recent <N>] [--verb <verb>] [--surface <surface>] [--unmarked] [--json]
```

The command reads schema-valid `kind: "event"` records from the selected outcome
store. It does not write records and it does not apply report mark override.
Its job is event discovery for humans.

`outcome events` displays each event's original auto-emitted or manually
recorded outcome, not the mark-corrected effective view. This is intentional:
event listing is the discovery surface for events that need marking or
re-marking, so it shows what the recorder captured at event time. For
mark-corrected aggregation, use `outcome report`. The `mark_count` and
`latest_mark_ts` JSON fields signal that a corrected view exists.

### Output Shape

Default output is a compact table:

```text
SHORTID   TS                    VERB                     OUTCOME  SURFACE        CATEGORY
1f3a2b4c  2026-05-20 14:23:01Z  live_check               failure  claude_plugin  stale_cache
9c7e8d12  2026-05-19 09:01:00Z  validate                 success  repo           -
```

Required table columns:

- `SHORTID`: first 8 lowercase UUID characters.
- `TS`: UTC timestamp formatted as `YYYY-MM-DD HH:mm:ssZ`.
- `VERB`: schema v0.1 verb.
- `OUTCOME`: schema v0.1 outcome.
- `SURFACE`: schema v0.1 surface.
- `CATEGORY`: `failure_category` when present, otherwise `-`.

`--json` emits a stable object:

```json
{
  "schema_version": "0.1",
  "events_version": "0.1",
  "generated_at": "2026-05-23T00:00:00.000Z",
  "project_hash": "abc123def456",
  "store": "user",
  "filters": {
    "recent": 20,
    "verb": null,
    "surface": null,
    "unmarked": false
  },
  "events": [
    {
      "id": "1f3a2b4c-0000-7000-8000-000000000000",
      "short_id": "1f3a2b4c",
      "ts": "2026-05-20T14:23:01.000Z",
      "verb": "live_check",
      "outcome": "failure",
      "surface": "claude_plugin",
      "failure_category": "stale_cache",
      "failure_driver": "cache",
      "plugin": "agent-trigger-kit",
      "marked": false,
      "mark_count": 0,
      "latest_mark_ts": null
    }
  ]
}
```

JSON output includes full ids so scripts do not need to re-resolve short ids.

### Filters

`--recent <N>` limits output to the newest N matching events. Default is `20`.
`N` must be a positive integer. The command filters first, sorts events by
descending event `ts`, breaks exact timestamp ties by newest JSONL position, and
then applies `--recent`.

`--verb <verb>` and `--surface <surface>` accept schema v0.1 enum values.
Unknown values exit `2`.

`--unmarked` shows only events that have no schema-valid mark whose
`related_id` equals the event id. Any mark for the event counts; the mark's
outcome does not matter.

`--unmarked` is a triage filter for first-pass marking. It does not surface
events that may have been marked incorrectly. To revisit a marked event, list
with `--recent` without `--unmarked` and inspect JSON `mark_count` or
`latest_mark_ts`.

### Short-Id Format And Ambiguity Handling

The event list defines the short-id convention used by `outcome mark`:

- A short id is a case-insensitive prefix of the canonical UUID string.
- Accepted prefix length is 4 to 36 characters.
- The printed human short id is always the first 8 UUID characters.

Prefixes are resolved against schema-valid event and mark record ids in the
selected store. If a prefix matches more than one record, the command rejects
it as ambiguous and prints candidate rows with short id, kind, timestamp, verb,
outcome, and surface. If a prefix uniquely matches a mark record, mark UX
rejects it as mark-of-mark rather than treating it as a missing event.

## `outcome mark` Improvements

### Positional Short-Id Resolution

Existing full UUID usage remains valid:

```text
agent-trigger-kit outcome mark --root <path> 1f3a2b4c-0000-7000-8000-000000000000 --outcome failure --failure-category misroute
```

The first positional argument may now be any unique 4-to-36-character UUID
prefix:

```text
agent-trigger-kit outcome mark --root <path> 1f3a2b4c --outcome failure --failure-category misroute
```

Resolution happens before `markOutcomeEvent` writes a mark. Missing prefixes
exit `4`, matching the existing missing-event convention. Ambiguous prefixes
exit `2` and list candidates.

### `--last` Selection Rules

Add:

```text
agent-trigger-kit outcome mark --root <path> --last [--verb <verb>] --outcome failure --failure-category stale_cache
```

`--last` selects the latest unmarked event in the selected store. If `--verb`
is provided, selection is limited to that verb. It sorts by event `ts`
descending and breaks exact timestamp ties by newest JSONL position.

`--last` and a positional event id are mutually exclusive. Supplying both exits
`2`.

If no matching unmarked event exists, the command exits `4`. This follows the
existing "there is no event to mark" exit-code boundary.

### Mark-Of-Mark Rejection

Marks must point at `kind: "event"` records. If a full id or short-id prefix
resolves uniquely to a `kind: "mark"` record, the command exits `2` with a
message explaining that marks cannot target marks.

To correct an existing mark, the operator writes a new mark for the same event.
Report aggregation already uses latest-mark-wins semantics.

## Interactive Prompts

### TTY Detection

Interactive prompts are enabled only when both `process.stdin.isTTY` and
`process.stdout.isTTY` are true. This prevents CI, pipes, and scripted use from
hanging.

When TTY mode is enabled and a required mark field is missing, the CLI prompts
for it. Required mark fields are:

- `outcome`, always.
- `failure_category`, only when the final outcome is `failure`.

Optional fields may also be prompted after required fields when they are absent:
`failure_driver` and `note`.

### Prompt Sequence

After resolving the target event, the prompt starts with context:

```text
Marking event 1f3a2b4c (live_check, failure, claude_plugin, 2026-05-20T14:23:01.000Z).
```

Then it asks:

```text
Outcome [success/failure/skipped/blocked]:
Failure category [stale_cache/version_skew/misroute/manifest_drift/missing_artifact/release_policy_gap/surface_residue/unknown]:
Failure driver (optional) [human/tooling/cache/network/config/unknown]:
Note (optional, blank to skip):
```

If an answer fails enum validation, the prompt repeats. Blank answers are
accepted only for optional fields. If `outcome` is not `failure`, the failure
category prompt is skipped and any provided failure category is still rejected
by schema validation.

### Non-TTY Fallback

When TTY mode is disabled, the CLI never prompts. Missing `outcome` or required
`failure_category` exits `2` with a short message naming the missing flag.

This keeps automation deterministic and makes CLI help the canonical reference
for non-interactive use.

## Edge Cases

### Ambiguous Short-Id

If prefix `1f3a` matches multiple schema-valid records, `outcome mark 1f3a`
exits `2` and prints enough candidates for the user to retry with a longer
prefix. The command must not write a mark in this case.

### `--last` With No Matching Event

`--last` ignores already marked events. If every event is marked, or if a verb
filter leaves no unmarked events, the command exits `4` and writes nothing.

### Multiple Marks On Same Event

Multiple marks on one event are valid. `outcome events --unmarked` excludes the
event once any mark exists. Report aggregation continues to use the latest mark
by mark `ts`.

If a mark is wrong, the correction path is to list marked events with
`outcome events --recent <N> --json`, inspect `mark_count` and
`latest_mark_ts`, then write a new mark against the same event. A future
`--has-marks` filter is deferred.

### Interactive Prompt Cancellation

Ctrl-C exits `130` and writes nothing. EOF before required answers exits `2`
and writes nothing. EOF after all required answers but before optional answers
treats the missing optional fields as absent.

## Tests

Focused tests should cover:

- `outcome events` human table lists newest matching events with short ids.
- `outcome events --json` includes full id, short id, filters, mark count, and
  latest mark timestamp.
- `--recent`, `--verb`, `--surface`, and `--unmarked` filter in the documented
  order.
- Invalid `--recent`, `--verb`, and `--surface` exit `2`.
- `outcome mark <short-id>` resolves a unique prefix and writes a mark for the
  full event id.
- Ambiguous short-id prefixes exit `2`, list candidates, and write nothing.
- Missing short-id prefixes exit `4`.
- A prefix resolving uniquely to a mark record exits `2` as mark-of-mark.
- `outcome mark --last --verb <verb>` selects the newest unmarked event for
  that verb.
- `--last` plus a positional id exits `2`.
- `--last` with no matching unmarked event exits `4`.
- Non-TTY mark commands missing required fields exit `2` and never prompt.
- Prompt planning can be unit-tested with an injectable prompt adapter so the
  enum validation and cancellation behavior do not require a real terminal.

## Impact On Existing Code

Expected implementation touch points:

- `scripts/lib/outcome-recorder.mjs`: add event-listing helpers, short-id
  resolution, unmarked selection, and mark target validation.
- `scripts/outcome-recorder.mjs`: add `events` subcommand, extend `mark`
  parsing with short ids and `--last`, and add TTY prompt flow.
- `tests/outcome-recorder.test.mjs` or a new `tests/outcome-mark-ux.test.mjs`:
  cover event listing, short-id resolution, `--last`, non-TTY behavior, and
  prompt planning.
- CLI usage text: document `outcome events`, short-id mark usage, and `--last`.

No schema changes are required. No report changes are required beyond consuming
marks that already follow schema v0.1.

## Deferred To v0.2+

- Bulk mark via predicates such as `--where verb=validate,outcome=failure`.
- Triage walk mode that steps through unmarked failures.
- Report deep-links that print ready-to-run mark commands.
- Mark editing or deletion.
- Web UI.
- Fuzzy search by plugin, note, or error code.
- Additional `--last` filters beyond `--verb`.
- `outcome events --has-marks` for revisiting previously marked events.
- A human-output `MARKED` column for `outcome events`; v0 keeps the human table
  compact and exposes mark state through `--unmarked` plus JSON `mark_count`.

## Open Questions

- Should short-id ambiguity candidate output include full UUIDs, or only longer
  prefixes plus context to keep terminal output compact?
- Should prompt mode ask optional `failure_driver` and `note` every time, or
  only when a flag such as `--prompt-all` exists in v0.2?
