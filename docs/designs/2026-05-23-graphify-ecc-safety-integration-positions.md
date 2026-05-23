status: v0.1-draft
date: 2026-05-23
primary_hypothesis: propagation-reliability
invalidates_when: problem statement primary hypothesis is demoted, registry MVP lands, or any re-evaluation trigger in this document fires
see_also: 2026-05-23-cross-agent-trigger-reliability-problem-statement.md

# Graphify, ECC, And Safety Integration Positions

## Graphify

Current stance: Agent Trigger Kit does not depend on Graphify, does not run a
Graphify runtime, and does not add a graph adapter in the propagation
reliability MVP.

Reasoning: All listed incidents except PR-5 are source-to-surface reliability
failures; PR-5 is discovery-related; no incident is context-bloat. See the
problem statement incident table.

Re-evaluation trigger: Reopen Graphify integration only when one rolling 60-day
outcome window has at least 10 marked failed or misrouted events and either 3
or more events have `failureDriver: context_bloat`, or context-bloat events are
20% or more of marked failed or misrouted events.

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
`surface`.

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
