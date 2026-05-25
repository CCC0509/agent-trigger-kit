# Agent Trigger Kit Claude Guidance

## Session Start

Run `agent-trigger-kit session-check` before changing files.

## Before Commit And Push

Run `npm run preflight` before any commit or push (ESLint, `prettier --check .`,
tests, `validate`, scratch-namespace check — the same gates CI enforces). CI
fails on `prettier --check .` for any unformatted tracked file, including
docs-only changes; run `npm run format` to fix formatting before pushing.

## Session Closeout

Run `agent-trigger-kit session-check --closeout` before reporting completion.
Mark or report unmarked events if closeout finds any.
