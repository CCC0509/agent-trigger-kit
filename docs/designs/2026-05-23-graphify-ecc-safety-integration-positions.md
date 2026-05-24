status: v0.2-merged
date: 2026-05-23
primary_hypothesis: propagation-reliability
invalidates_when: problem statement primary hypothesis is demoted, registry MVP lands, outcome evidence cannot be emitted reliably, or any re-evaluation trigger in this document fires
see_also: 2026-05-23-cross-agent-trigger-reliability-problem-statement.md

# Graphify, ECC, And Safety Integration Positions

## Summary

Graphify, ECC-style learning, and runtime safety gates are not integrated in the
v0.2 runtime. Agent Trigger Kit uses outcome recording as the only v0 evidence
layer, and these integrations should be re-evaluated only after human-marked
outcome evidence reaches the thresholds below.

This is an evidence gate, not a permanent rejection. The thresholds must be read
with the operational dependency that outcome auto-emission works in the
operator environments that matter. If sandbox or restricted-home runs cannot
write outcome records reliably, the denominator and numerator for these gates
can both be undercounted.

## Schema Vocabulary Note

This document predates outcome schema v0.1 and originally used
implementation-shaped field names such as `failureCategory`, `failureDriver`,
and `operationKind`. Schema v0.1 writes `failure_category`, `failure_driver`,
and `verb`; it does not preserve a separate operation-kind axis.

For implementation work, use `2026-05-24-outcome-evidence-gates-v0.3.md` as
the canonical gate semantics. The older trigger descriptions below are retained
as historical rationale for the v0.2 position, not as executable report queries.

## Graphify

Current stance: Agent Trigger Kit does not depend on Graphify, does not run a
Graphify runtime, and does not add a graph adapter in the propagation
reliability MVP.

Reasoning: All listed incidents except PR-5 are source-to-surface reliability
failures; PR-5 is discovery-related; no incident is context-bloat. See the
problem statement incident table.

Re-evaluation trigger: Reopen Graphify integration only when a schema-supported
context-bloat evidence axis exists and one rolling 60-day outcome window has at
least 10 marked failed or misrouted events and either 3 or more context-bloat
events, or context-bloat events are 20% or more of marked failed or misrouted
events.

## ECC

Current stance: Agent Trigger Kit does not integrate ECC runtime observation,
instinct extraction, continuous-learning skill evolution, or automatic rule
generation. Outcome recording is the only v0 evidence layer.

Reasoning: The problem statement requires human-labeled ground truth before any
learning claim. PR-1 through PR-10 show repeatability and lifecycle pain, but
they do not prove that automatic rule extraction would reduce propagation
failures. Without marks, an ECC-style loop would learn from unverified events.

Re-evaluation trigger: Reopen ECC-style rule suggestion only when one rolling
60-day outcome window has at least 20 marked events and at least 5 repeated
failed events share the same `failure_category`, `plugin`, and `surface`
3-tuple. `failure_driver` is a breakdown, not part of the primary repetition
key.

## Safety

Current stance: Safety remains advisory and is expressed through validation,
premerge checks, and explicit reports. Agent Trigger Kit does not claim runtime
tool-call enforcement inside Codex, Claude, or Cursor.

Reasoning: The problem statement incidents that touch safety are release and
residue controls, not host-runtime interception. PR-7 concerns main-bound
scratch or generated-artifact pollution. PR-10 concerns orphan generated
surfaces. Those incidents fit static or premerge validation better than a
separate shield subsystem.

Re-evaluation trigger: Reopen a trigger-admission safety gate only when a
schema-supported mutation or safety denominator exists and one rolling 60-day
outcome window has at least 3 marked safety-relevant events with
`failure_category: "release_policy_gap"` or
`failure_category: "surface_residue"`.

## Normalization Follow-Ups

- Use `2026-05-24-outcome-evidence-gates-v0.3.md` for the canonical 60-day
  window anchor, denominator families, ECC repetition key, and gate report
  shape.
- Keep outcome auto-emission reliability as a prerequisite for these gates.
  Restricted-home sandbox write failures, tracked in issue #6, can prevent
  events from reaching the store and make re-evaluation thresholds appear unmet.
- Keep schema-gap gates disabled until a separate schema design proves and names
  the missing evidence axis. v0.3 intentionally names the Graphify and Safety
  gaps without freezing v0.2 field names.
