# Harness Automation (Optional)

**Status:** Durable operations note for wiring Agent Trigger Kit checks into a
host agent harness.

Agent Trigger Kit ships **no hooks and no background automation**. The
`validate`, `live-check`, `session-check`, and `outcome` commands are read-only
and run only when something invokes them.

This note describes how an operator can _optionally_ wire those read-only
commands into a host harness (Claude Code hooks, git hooks, CI) so the checks
fire automatically. The kit's behavior does not change — the harness decides
_when_ to run the checks; the commands stay pure.

Keep this wiring in personal, gitignored config (`.claude/settings.local.json`),
not in the kit's shipped tree. It is operator setup, not a kit feature.

## Per-agent reality

Deterministic tool-call hooks exist only for **Claude Code**. **Codex** and
**Cursor** have no equivalent shell-hook mechanism, so their triggers are
instruction-based (`AGENTS.md` and `.cursor/rules/`) and depend on the agent
following them. The only agent-agnostic, enforced layer is **git hooks + CI** —
that is where the real cross-agent guarantee lives. Plan accordingly: use git
pre-push and CI as the hard gate for all three agents, and treat the per-agent
in-session triggers as best-effort acceleration.

## What can be automated vs not

| Concern                                                                      | Mechanism                                | Automatable               |
| ---------------------------------------------------------------------------- | ---------------------------------------- | ------------------------- |
| Run `validate` when trigger files change                                     | `PostToolUse` hook on `Edit`/`Write`     | Fully — harness-driven    |
| Session health at start                                                      | `SessionStart` hook → `session-check`    | Fully                     |
| Surface unmarked outcomes at finish                                          | `Stop` hook → `session-check --closeout` | Fully (advisory)          |
| Static gates before push                                                     | git `pre-push` hook                      | Fully                     |
| Record a **qualitative** failure (skill missing, stale cache, wrong command) | `outcome record`                         | Judgment only — see below |

There is no error signal to hook onto when a skill silently fails to appear or a
cache is stale, so recording those outcomes stays a human/agent decision. The
`Stop` closeout is the mitigation: it lists unmarked events plus ready-to-paste
`outcome mark` commands every time the agent finishes, turning "you must
remember" into "the harness reminds you." Do not auto-record synthetic
successes — the outcome store exists to collect real failure signal.

## Pin file

Consumer repos should keep one committed Agent Trigger Kit ref in
`.agent-trigger-kit/pin`. Hooks, CI, `AGENTS.md`, and Cursor rules read that file
at runtime, so version bumps happen in one small diff.

Create the pin with the tag or ref you want the repo to use:

```bash
mkdir -p .agent-trigger-kit
printf 'v0.2.3\n' > .agent-trigger-kit/pin
git add .agent-trigger-kit/pin
```

## Claude Code hooks (consumer repo)

Write this to the consumer repo's `.claude/settings.local.json` and add
`.claude/settings.local.json` to `.gitignore`. These hooks read
`.agent-trigger-kit/pin` each time they run. Missing pins are skipped with a
clear message because the hooks are optional harness wiring.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "sh -lc 'PIN_FILE=\"$CLAUDE_PROJECT_DIR/.agent-trigger-kit/pin\"; if [ ! -f \"$PIN_FILE\" ]; then echo \"agent-trigger-kit pin missing at $PIN_FILE; skipping optional harness check\"; exit 0; fi; KIT_REF=\"$(tr -d '\"'\"'[:space:]'\"'\"' < \"$PIN_FILE\")\"; KIT_SPEC=\"github:CCC0509/agent-trigger-kit#$KIT_REF\"; npx --yes \"$KIT_SPEC\" session-check --root \"$CLAUDE_PROJECT_DIR\" || true; npx --yes \"$KIT_SPEC\" pin-check --no-outcome --root \"$CLAUDE_PROJECT_DIR\" || true'",
            "statusMessage": "agent-trigger-kit session-check"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "sh -lc 'PIN_FILE=\"$CLAUDE_PROJECT_DIR/.agent-trigger-kit/pin\"; if [ ! -f \"$PIN_FILE\" ]; then echo \"agent-trigger-kit pin missing at $PIN_FILE; skipping optional harness check\"; exit 0; fi; KIT_REF=\"$(tr -d '\"'\"'[:space:]'\"'\"' < \"$PIN_FILE\")\"; export KIT_SPEC=\"github:CCC0509/agent-trigger-kit#$KIT_REF\"; node -e '\"'\"'let d=\"\";process.stdin.on(\"data\",c=>d+=c);process.stdin.on(\"end\",()=>{let i={};try{i=JSON.parse(d)}catch{}const f=(i.tool_input&&i.tool_input.file_path)||\"\";const hit=[\"/.agents/\",\"/.claude-plugin/\",\"/.cursor/\",\"/.agent-trigger-kit/\"].some(s=>f.includes(s))||f.endsWith(\"/AGENTS.md\");if(hit){const cp=require(\"child_process\");const dir=process.env.CLAUDE_PROJECT_DIR||\".\";const r=cp.spawnSync(\"npx\",[\"--yes\",process.env.KIT_SPEC,\"validate\",\"--root\",dir],{stdio:\"inherit\"});process.exit(r.status||0)}})'\"'\"''",
            "statusMessage": "validate trigger layer"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "sh -lc 'PIN_FILE=\"$CLAUDE_PROJECT_DIR/.agent-trigger-kit/pin\"; if [ ! -f \"$PIN_FILE\" ]; then echo \"agent-trigger-kit pin missing at $PIN_FILE; skipping optional harness check\"; exit 0; fi; KIT_REF=\"$(tr -d '\"'\"'[:space:]'\"'\"' < \"$PIN_FILE\")\"; KIT_SPEC=\"github:CCC0509/agent-trigger-kit#$KIT_REF\"; npx --yes \"$KIT_SPEC\" session-check --closeout --root \"$CLAUDE_PROJECT_DIR\" || true'",
            "statusMessage": "agent-trigger-kit closeout"
          }
        ]
      }
    ]
  }
}
```

The `PostToolUse` command reads the hook payload from stdin, extracts
`tool_input.file_path`, and only runs `validate` when the path touches a trigger
surface (`.agents/`, `.claude-plugin/`, `.cursor/`, `.agent-trigger-kit/`, or
`AGENTS.md`). Every other edit is a silent no-op.

### Activation caveat

Claude Code's settings watcher only watches `.claude/` if a settings file was
present there when the session started. After creating
`.claude/settings.local.json` for the first time, open `/hooks` once (reloads
config) or restart the session — otherwise the settings hooks do not fire in the
current session.

### Speed note

`PostToolUse` fires often. `npx --yes github:...` fetches on first use (and
caches after), but for repos with heavy trigger-file editing, install the kit
locally to avoid network on every edit:

```bash
KIT_REF="$(tr -d '[:space:]' < .agent-trigger-kit/pin)"
npm i -D "github:CCC0509/agent-trigger-kit#$KIT_REF"
```

Then call `npx agent-trigger-kit ...` (resolves from `node_modules/.bin`) in the
hooks instead of `npx --yes github:...`, and change the `PostToolUse`
`spawnSync` arguments to `["agent-trigger-kit","validate","--root",dir]`.

### Where pin-check runs

- `SessionStart`: run `pin-check --no-outcome` as a notification only. It should
  not fail the session and should not create repeated closeout work.
- CI: run `pin-check --strict` after reading the pinned kit. A stale comparable
  semver pin fails CI; degraded latest-tag lookup remains fail-open.
- Renovate: open the actual bump PR by changing only `.agent-trigger-kit/pin`.

## Codex and Cursor (instruction-based)

Neither Codex nor Cursor exposes a deterministic tool-call hook. Wire their
triggers as instructions in the cross-agent trigger layer the kit already
manages, and rely on git pre-push + CI for the enforced part.

For **Codex**, add a clearly-marked section to `AGENTS.md`:

```markdown
## Agent Trigger Kit checks

Use the version in `.agent-trigger-kit/pin`.

- Derive `KIT_SPEC` before running checks:
  `KIT_REF="$(tr -d '[:space:]' < .agent-trigger-kit/pin)"; KIT_SPEC="github:CCC0509/agent-trigger-kit#$KIT_REF"`
- At session start: `npx --yes "$KIT_SPEC" session-check --root .`
- After editing `.agents/`, `.claude-plugin/`, `.cursor/`, `.agent-trigger-kit/`,
  or `AGENTS.md`: `npx --yes "$KIT_SPEC" validate --root .`
- Before reporting completion: `npx --yes "$KIT_SPEC" session-check --closeout --root .`
- Record real failures (skill missing, stale cache, wrong command) with
  `npx --yes "$KIT_SPEC" outcome record ...`. Never fabricate successes.
```

For **Cursor**, add `.cursor/rules/agent-trigger-kit.mdc` carrying the same four
instructions:

```markdown
---
description: Agent Trigger Kit checks
alwaysApply: true
---

Use the version in `.agent-trigger-kit/pin`. Derive
`KIT_SPEC="github:CCC0509/agent-trigger-kit#$KIT_REF"` from that file with
`tr -d '[:space:]'`. Run `session-check` at session start, `validate` after
editing trigger surfaces (`.agents/`, `.claude-plugin/`, `.cursor/`,
`.agent-trigger-kit/`, `AGENTS.md`), and `session-check --closeout` before
reporting done. Record real failures with `outcome record`; never fabricate
successes.
```

These are best-effort: they fire only if the agent follows them. The git
pre-push hook and CI below are what actually enforce the checks regardless of
which agent (or human) is driving.

## Working inside this repository

When dogfooding the kit on itself, the CLI is local, so the hooks call
`node "$CLAUDE_PROJECT_DIR/scripts/cli.mjs" <command>` instead of `npx`. The
`pre-push` hook is installed with the bundled helper:

```bash
node scripts/install-hooks.mjs --root .
```

It writes a `pre-push` that runs `npm run check:scratch-namespace` and
`npm run ops:premerge-version-check -- --base origin/main`, and refuses to
overwrite an existing hook.

## CI is the static-gate home

Static checks belong in CI, not in interactive hooks alone. See the CI and
version-check guidance in the README. Derive the kit version from the committed
pin in CI:

```sh
test -f .agent-trigger-kit/pin || {
  echo "missing .agent-trigger-kit/pin; create it with the Agent Trigger Kit tag to pin"
  exit 1
}
KIT_REF="$(tr -d '[:space:]' < .agent-trigger-kit/pin)"
KIT_SPEC="github:CCC0509/agent-trigger-kit#$KIT_REF"
npx --yes "$KIT_SPEC" validate --root .
npx --yes "$KIT_SPEC" pin-check --strict --root .
```

`live-check` stays a manual operator or release gate because it inspects local
installed Codex/Claude state, which CI cannot see.

## Renovate auto-bump

Renovate can bump semver tag pins by changing only `.agent-trigger-kit/pin`.
Add this custom manager to the consumer repo's Renovate config:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "customManagers": [
    {
      "customType": "regex",
      "managerFilePatterns": ["/^\\.agent-trigger-kit\\/pin$/"],
      "matchStrings": ["^(?<currentValue>v?\\d+\\.\\d+\\.\\d+)\\s*$"],
      "datasourceTemplate": "github-tags",
      "depNameTemplate": "CCC0509/agent-trigger-kit",
      "versioningTemplate": "semver-coerced"
    }
  ]
}
```

This uses current Renovate terminology for regex custom managers:
`managerFilePatterns` and `matchStrings`. `github-tags` has no datasource-level
default versioning, so the snippet sets `versioningTemplate: "semver-coerced"`
to handle `v0.2.3` and `0.2.3` pins.

Activation paths:

- Mend Renovate App: add the custom manager to the consumer repo's Renovate
  config and let the hosted app open PRs.
- Self-hosted Renovate Action: schedule Renovate in GitHub Actions with the
  same config for repositories that do not use the hosted app.

SHA or non-semver ref pins remain valid Agent Trigger Kit pins, but Renovate's
automatic bump path only targets semver tags. Validate the snippet locally with
`renovate-config-validator --no-global` before enabling it.
