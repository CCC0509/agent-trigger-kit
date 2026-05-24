status: v0.2-draft
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

| ID    | Incident                                                                                           | Schema Category    | Measurable Signal                                                                                                       |
| ----- | -------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| PR-1  | Source plugin version current while Codex or Claude cache is stale.                                | stale_cache        | `sourceVersion != installedCacheVersion` for the same plugin.                                                           |
| PR-2  | Claude project plugin cache version differs from source manifest version.                          | version_skew       | `claudeProjectVersion != sourcePluginVersion`.                                                                          |
| PR-3  | Codex keeps a project plugin in user global config after temporary discovery.                      | surface_residue    | Codex config contains a forbidden project plugin id after cleanup.                                                      |
| PR-4  | Plugin-visible change lands without aligned manifest and changelog bump.                           | release_policy_gap | Premerge version check reports a plugin-visible diff without aligned source versions.                                   |
| PR-5  | Generated skill descriptions were too sparse before playbook-first guidance and task descriptions. | misroute           | Human-labeled only: no automated proxy in v0; ground truth comes from a human mark with `failure_category: "misroute"`. |
| PR-6  | Wrapper, command, marketplace, and Cursor rule drift across generated surfaces.                    | manifest_drift     | Static validator reports generated file checksum, frontmatter, command, or Cursor rule drift.                           |
| PR-7  | Scratch namespace or generated docs pollution reaches main-bound work.                             | release_policy_gap | Scratch/premerge check reports a blocked namespace or generated artifact policy violation.                              |
| PR-8  | Claude plugin lifecycle issues such as stale cache, `.orphaned_at`, or restart-required state.     | stale_cache        | Claude installed-state probe reports source/cache mismatch or orphaned plugin state.                                    |
| PR-9  | Trigger-layer source changed, but no read-only live evidence proves runtime discovery.             | missing_artifact   | Live matrix row for an expected surface is absent, inconclusive, or not discoverable.                                   |
| PR-10 | Removed tasks leave orphan generated wrappers or commands.                                         | surface_residue    | Clean dry-run reports generated files present on disk but absent from the generated manifest.                           |

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

Schema v0.1 is the canonical JSONL record contract for implementation. It
writes `schema_version`, `kind`, `id`, `ts`, `verb`, `outcome`, `surface`,
optional `failure_category`, optional `failure_driver`, and related metadata as
documented in `2026-05-23-outcome-event-schema-v0.1.md`.

Older drafts of this problem statement used pre-v0.1 names such as
`schemaVersion`, `recordType`, `eventId`, `recordedAt`, `markedAt`,
`operationKind`, `failureCategory`, and `failureDriver`. Those names are
historical. New report and gate work must use schema v0.1 names.

Gate-level query semantics are documented in
`2026-05-24-outcome-evidence-gates-v0.3.md`. That design intentionally disables
gates whose queries would lie under schema v0.1.

## Storage, Privacy, And Retention

The default store is user-level:

```text
~/.agent-trigger-kit/outcomes/<project-hash>/events.jsonl
```

Payload content, prompts, file contents, and full trigger request bodies are not
recorded by default. Metadata such as plugin name, surface, verb, duration,
enum category, and enum driver is recorded.

Project-local storage is opt-in. If a project-local store is selected, the path
is `.agent-trigger-kit/outcomes/events.jsonl`, and the CLI must create
`.agent-trigger-kit/outcomes/.gitignore` with:

```text
*
!.gitignore
```

Retention is rolling 90 days or 1000 records per `project_hash`, whichever limit
is reached first. If an operator marks an event that has already been removed by
retention, the command exits with code `4` and prints
`event <id> not found; it may have expired under the retention policy`.
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
  marked events and fewer than 15% are propagation-reliability failures under
  the incident-signal mapping above. This is a review-level classification, not
  a v0.1 `failure_driver` enum value.

## Expansion Gates

- Pause Graphify or graph-context work unless the v0.3 Graphify gate becomes
  schema-supported and triggered.
- Pause registry automation if a 60-day sample has fewer than 3 `misroute`
  marked failures and misroutes are below 10% of marked events.
- Pause ECC-style rule suggestion work unless the v0.3 ECC gate finds at least 5
  repeated marked failures with the same `failure_category`, `plugin`, and
  `surface` 3-tuple.
- Keep safety work advisory-only unless the v0.3 Safety gate becomes
  schema-supported and triggered.
- Revisit the recorder itself if 30 days after adoption fewer than 5 events have
  any human mark, or if 120 days after adoption fewer than 10 events have any
  human mark; without marks, reports cannot validate or refute this problem
  statement.
