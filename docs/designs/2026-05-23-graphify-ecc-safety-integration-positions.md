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

## Graphify

Current stance: Agent Trigger Kit does not depend on Graphify, does not run a
Graphify runtime, and does not add a graph adapter in the propagation
reliability MVP.

Reasoning: All listed incidents except PR-5 are source-to-surface reliability
failures; PR-5 is discovery-related; no incident is context-bloat. See the
problem statement incident table.

Re-evaluation trigger: Reopen Graphify integration only when one rolling 60-day
outcome window has at least 10 marked failed or misrouted events and either 3 or
more of those events have `failureDriver: context_bloat`, or context-bloat
events are 20% or more of marked failed or misrouted events.

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
events share the same `failureCategory`, `failureDriver`, `plugin`, and
`surface` 4-tuple.

## Safety

Current stance: Safety remains advisory and is expressed through validation,
premerge checks, and explicit reports. Agent Trigger Kit does not claim runtime
tool-call enforcement inside Codex, Claude, or Cursor.

Reasoning: The problem statement incidents that touch safety are release and
residue controls, not host-runtime interception. PR-7 concerns main-bound
scratch or generated-artifact pollution. PR-10 concerns orphan generated
surfaces. Those incidents fit static or premerge validation better than a
separate shield subsystem.

Re-evaluation trigger: Reopen a trigger-admission safety gate only when one
rolling 60-day outcome window has at least 3 marked events with
`operationKind: mutation` and `failureCategory: release_policy_gap` or
`surface_residue`.

## Normalization Follow-Ups

- Define the 60-day window anchor explicitly before dashboarding these gates.
  Candidate anchors are event timestamp, mark timestamp, or report generation
  time; event timestamp is the likely default because it describes when the
  trigger failure happened.
- Align gate denominators before comparing Graphify, ECC, and safety in one
  report. Graphify currently uses marked failed or misrouted events, while ECC
  uses all marked events.
- Revisit the ECC repetition key if the 4-tuple proves too sparse. A 3-tuple or
  a wildcardable `failureDriver` may be enough to identify repeated rule
  suggestion candidates without pushing the gate out of reach.
- Keep outcome auto-emission reliability as a prerequisite for these gates.
  Restricted-home sandbox write failures, tracked separately in issue #6, can
  prevent events from reaching the store and make the re-evaluation thresholds
  appear unmet.
