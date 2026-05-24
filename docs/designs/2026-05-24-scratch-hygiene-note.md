# Scratch Hygiene Note

**Status:** Durable operations note for manual Agent Trigger Kit development
flows.

Temporary Agent Trigger Kit artifacts belong under randomized scratch paths and
must be removed when the session that created them ends.

Use randomized paths for sandbox HOME fallbacks. Prefer names such as
`agent-trigger-kit-session-<random>` created through `mktemp -d` instead of a
fixed path:

```bash
scratch_home="$(mktemp -d -t agent-trigger-kit-session.XXXXXX)"
trap 'rm -rf "$scratch_home"' EXIT
HOME="$scratch_home" npm run validate
```

Any fixed-name artifact under `${TMPDIR}/agent-trigger-kit-*` or
`/private/tmp/agent-trigger-kit-*`, whether it is a file or directory, is
short-lived scratch. If it survives more than one session, it is an orphan and
belongs to ops cleanup.

This note covers future hygiene only. Existing `/private/tmp` residue is not
part of feature implementation scope.
