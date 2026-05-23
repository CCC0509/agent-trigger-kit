status: v0.1-draft
date: 2026-05-23
primary_hypothesis: propagation-reliability
invalidates_when: 60-day outcome sample has 10+ marked events and fewer than 15% are propagation failures, or 3+ marked events identify one non-propagation driver as the top failure driver, or 120-day outcome sample has fewer than 10 marked events, or a registry MVP lands
see_also: 2026-05-23-graphify-ecc-safety-integration-positions.md

# Cross-Agent Trigger Reliability Problem Statement

## Primary Hypothesis

For the first 60 days after outcome recording begins, at least 15% of
outcome-marked events tied to trigger-layer changes will be propagation
reliability failures: the source tree changed, but one or more Codex, Claude, or
Cursor surfaces did not reflect the intended version, existence, freshness, or
generated-file state.

This hypothesis is falsifiable. If the 60-day sample has at least 10 marked
events and fewer than 15% are propagation failures, propagation reliability is
demoted as the v1 primary bottleneck. If three or more marked events name the
same non-propagation driver as the top failure driver, the problem statement
must be revised before any Graph, registry, learning, or safety expansion.
If the 60-day sample has fewer than 10 marked events, the observation window
extends to 120 days. If the 120-day sample still has fewer than 10 marked
events, recorder adoption failed and this hypothesis remains untested.

## Incident Signals

| ID    | Incident                                                                                           | Category           | Measurable Signal                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| PR-1  | Source plugin version current while Codex or Claude cache is stale.                                | cache_stale        | `sourceVersion != installedCacheVersion` for the same plugin.                                                            |
| PR-2  | Claude project plugin cache version differs from source manifest version.                          | version_mismatch   | `claudeProjectVersion != sourcePluginVersion`.                                                                           |
| PR-3  | Codex keeps a project plugin in user global config after temporary discovery.                      | surface_residue    | Codex config contains a forbidden project plugin id after cleanup.                                                       |
| PR-4  | Plugin-visible change lands without aligned manifest and changelog bump.                           | release_policy_gap | Premerge version check reports a plugin-visible diff without aligned source versions.                                    |
| PR-5  | Generated skill descriptions were too sparse before playbook-first guidance and task descriptions. | misroute           | Human-labeled only: no automated proxy in v0; ground truth comes from a `misroute` mark with `failureDriver: discovery`. |
| PR-6  | Wrapper, command, marketplace, and Cursor rule drift across generated surfaces.                    | surface_drift      | Static validator reports generated file checksum, frontmatter, command, or Cursor rule drift.                            |
| PR-7  | Scratch namespace or generated docs pollution reaches main-bound work.                             | release_policy_gap | Scratch/premerge check reports a blocked namespace or generated artifact policy violation.                               |
| PR-8  | Claude plugin lifecycle issues such as stale cache, `.orphaned_at`, or restart-required state.     | cache_stale        | Claude installed-state probe reports source/cache mismatch or orphaned plugin state.                                     |
| PR-9  | Trigger-layer source changed, but no read-only live evidence proves runtime discovery.             | surface_missing    | Live matrix row for an expected surface is absent, inconclusive, or not discoverable.                                    |
| PR-10 | Removed tasks leave orphan generated wrappers or commands.                                         | surface_residue    | Clean dry-run reports generated files present on disk but absent from the generated manifest.                            |

## Secondary Hypotheses

Context bloat, discovery, and runtime trust remain secondary hypotheses. PR-5 is
the only listed incident that touches discovery, and it has already produced
playbook-first guidance plus task descriptions. PR-5 is human-labeled only in
v0, unlike the propagation incidents with validator, diff, probe, or cleanup
signals. No listed incident supports context bloat as a current bottleneck. No
listed incident proves that target agent behavior drift, after correct trigger
propagation, is the current primary failure mode.

Secondary hypotheses can be promoted only by outcome data. A promotion requires
at least 3 marked events in one 60-day window for the same non-propagation
driver, or at least 20% of marked failed or misrouted events in that window.

## Measurement Contract

Outcome evidence is human-labeled. Events are facts about checks, routing
attempts, or release operations. Marks are the ground truth layer applied by a
human operator.

Each JSONL record uses `schemaVersion: 1`. `recordType` is `event` or `mark`.
All timestamps are UTC ISO8601 strings ending in `Z`. `eventId` is stable for
the original event. `projectHash` is the first 12 hex characters of a SHA-256
hash of the canonical project root path.

Required event fields:

- `schemaVersion`: `1`
- `recordType`: `event`
- `eventId`: string
- `recordedAt`: UTC ISO8601 with `Z`
- `projectHash`: string
- `plugin`: string
- `surface`: `codex`, `claude`, `cursor`, `repo`, or `unknown`
- `operationKind`: `static_check`, `live_check`, `generation`, `cleanup`,
  `mutation`, or `manual`
- `durationMs`: non-negative integer
- `failureCategory`: one of `cache_stale`, `version_mismatch`,
  `surface_missing`, `surface_drift`, `surface_residue`,
  `release_policy_gap`, `misroute`, `unknown`
- `failureDriver`: `propagation`, `context_bloat`, `discovery`,
  `runtime_trust`, or `other`

Required mark fields:

- `schemaVersion`: `1`
- `recordType`: `mark`
- `eventId`: string
- `markedAt`: UTC ISO8601 with `Z`
- `result`: `success`, `failed`, or `misroute`
- `failureCategory`: same enum as event records
- `failureDriver`: same enum as event records
- `reason`: optional single-line string, maximum 200 characters

`reason` is not a registry and is not used for primary metrics. It is capped to
reduce leakage and to keep reports reviewable.

## Storage, Privacy, And Retention

The default store is user-level:

```text
~/.agent-trigger-kit/outcomes/<project-hash>/events.jsonl
```

Payload content, prompts, file contents, and full trigger request bodies are not
recorded by default. Metadata such as plugin name, surface, operation kind,
duration, enum category, and enum driver is recorded.

Project-local storage is opt-in. If a project-local store is selected, the path
is `.agent-trigger-kit/outcomes/events.jsonl`, and the CLI must create
`.agent-trigger-kit/outcomes/.gitignore` with:

```text
*
!.gitignore
```

Retention is rolling 90 days or 1000 records per `projectHash`, whichever limit
is reached first. If an operator marks an event that has already been removed by
retention, the command exits with code `4` and prints
`event <eventId> not found; it may have expired under the retention policy`.
Silent no-op marking is not allowed.

## Reader Contract

Explicit reports are the reader surface. A report can aggregate by failure
category, failure driver, plugin, surface, and 60-day window. Static validation
may check outcome file syntax and enum validity, but validation must not print
outcome metrics by default.

## No Registry In MVP

MVP measurement does not include a trigger registry. Automated misroute
detection is therefore out of scope. Every `misroute` result is produced by a
human `outcome mark` action, not by inferred task, source-agent, or target-agent
matching.

Outcome events are evidence. Outcome marks are ground truth. Until a registry
MVP exists, misroute rate is 100% human-labeled.

## Hypothesis Falsification

- Demote propagation reliability if the first 60-day sample has at least 10
  marked events and fewer than 15% have `failureDriver: propagation`.

## Expansion Gates

- Pause any Graphify or graph-context work if a 60-day sample has fewer than 3
  events with `failureDriver: context_bloat` and context-bloat events are below
  20% of marked failed or misrouted events.
- Pause registry automation if a 60-day sample has fewer than 3 `misroute`
  marks and misroutes are below 10% of marked events.
- Pause ECC-style rule suggestion work if a 60-day sample has fewer than 5
  repeated events with the same `failureCategory`, `failureDriver`, `plugin`,
  and `surface`.
- Keep safety work advisory-only if a 60-day sample has fewer than 3 events with
  `operationKind: mutation` and `failureCategory: release_policy_gap` or
  `surface_residue`.
- Revisit the recorder itself if 30 days after adoption fewer than 5 events have
  any human mark, or if 120 days after adoption fewer than 10 events have any
  human mark; without marks, reports cannot validate or refute this problem
  statement.
