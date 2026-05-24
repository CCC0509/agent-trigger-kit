---
name: session-check
description: Use when starting/ending a repo session or checking session health/closeout.
---

# Session Check

Use this when starting or ending a repo session, checking session health, or
preparing closeout.

## Commands

- Session start: run `agent-trigger-kit session-check` before changing files.
- Session closeout: run `agent-trigger-kit session-check --closeout` before
  leaving or reporting completion.
- Machine-readable output: add `--json` when the caller needs structured
  status.

## Exit Codes

- `0`: healthy.
- `1`: validate fail.
- `2`: usage error.
- `3`: degraded outcome store.
- `4`: unmarked events.

For closeout, mark unmarked events when possible; otherwise report them clearly.
The check is read-only. It does not need the outcome store to be writable; it
only needs readable existing state, so it can still succeed under sandboxed
HOME directories where writes are blocked. Avoid hooks, background automation,
or background triggers for session-check behavior.
