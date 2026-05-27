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
            "command": "node -e 'let d=\"\";process.stdin.on(\"data\",c=>d+=c);process.stdin.on(\"end\",()=>{let i={};try{i=JSON.parse(d)}catch{}const f=(i.tool_input&&i.tool_input.file_path)||\"\";const hit=[\"/.agents/\",\"/.claude-plugin/\",\"/.cursor/\",\"/.agent-trigger-kit/\"].some(s=>f.includes(s))||f.endsWith(\"/AGENTS.md\");if(!hit)return;const fs=require(\"fs\");const path=require(\"path\");const cp=require(\"child_process\");const dir=process.env.CLAUDE_PROJECT_DIR||\".\";const pinFile=path.join(dir,\".agent-trigger-kit/pin\");if(!fs.existsSync(pinFile)){console.log(\"agent-trigger-kit pin missing at \"+pinFile+\"; skipping optional harness check\");return;}const kitRef=fs.readFileSync(pinFile, \"utf8\").replace(/\\s+/g, \"\");const kitSpec=\"github:CCC0509/agent-trigger-kit#\"+kitRef;const r=cp.spawnSync(\"npx\",[\"--yes\",kitSpec,\"validate\",\"--root\",dir],{stdio:\"inherit\"});process.exit(r.status||0)})'",
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
`tool_input.file_path`, and only reads `.agent-trigger-kit/pin` and runs
`validate` when the path touches a trigger surface (`.agents/`,
`.claude-plugin/`, `.cursor/`, `.agent-trigger-kit/`, or `AGENTS.md`). Every
other edit is a silent no-op.

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

### Closeout invocation policy

The Stop hook above is advisory. It may stay compact; operators can also run the
full ladder manually when the hook output does not prove closeout ran. A
closeout attempt counts as having run only when output includes
`Session closeout check`. If a caller uses JSON output, require both
`"kind": "session_check"` and `"mode": "closeout"`.

When a closeout report appears, trust that report and its printed exit code. Do
not run a later tier to mask a non-zero closeout result.

Use tiers in this order:

1. Source repo dogfood: `node scripts/cli.mjs session-check --closeout --root .`
2. Consumer installed package: `$ROOT/node_modules/.bin/agent-trigger-kit`
3. Verified PATH/global package: `command -v agent-trigger-kit` plus a semver pin version gate
4. Pinned external package: `npx --yes "$KIT_SPEC" session-check --closeout --root "$ROOT"`

The PATH/global tier is an opportunistic, low-integrity optimization for
synchronized local environments. `agent-trigger-kit --version` reports the
PATH binary's package version. Package-version equality only proves that the
binary declares the same package version as a semver pin; it is not proof of
pinned-ref content equivalence. Strict integrity still belongs to the pinned
external tier, which resolves the configured ref.

Non-semver pins, including branch names and commit SHAs, skip the PATH tier and
fall through to pinned external `npx`.

Do not use `npx --no-install agent-trigger-kit ...` as the installed-package
tier: npm 11.6.2 can still hit the registry on a local miss before any closeout
report appears.

<!-- closeout-ladder:start -->

```sh
ROOT="${ROOT:-.}"
LOCAL_ATK="$ROOT/node_modules/.bin/agent-trigger-kit"
PIN_FILE="$ROOT/.agent-trigger-kit/pin"
KIT_REPO="${KIT_REPO:-CCC0509/agent-trigger-kit}"
CLOSEOUT_REPORT_SEEN=0
CLOSEOUT_EXIT=1

run_closeout_tier() {
  if [ "$CLOSEOUT_REPORT_SEEN" -eq 1 ]; then
    return 0
  fi

  CLOSEOUT_OUTPUT="$("$@" 2>&1)"
  CLOSEOUT_EXIT="$?"
  printf '%s\n' "$CLOSEOUT_OUTPUT"
  if printf '%s\n' "$CLOSEOUT_OUTPUT" | grep -q 'Session closeout check'; then
    CLOSEOUT_REPORT_SEEN=1
  fi
  return 0
}

realpath_or_same() {
  if command -v realpath >/dev/null 2>&1; then
    realpath "$1" 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

if [ -x "$LOCAL_ATK" ]; then
  run_closeout_tier "$LOCAL_ATK" session-check --closeout --root "$ROOT"
else
  echo "agent-trigger-kit local binary missing; status=not_installed"
fi

if [ "$CLOSEOUT_REPORT_SEEN" -eq 0 ]; then
  PATH_ATK="$(command -v agent-trigger-kit 2>/dev/null || true)"
  LOCAL_ATK_REAL=""
  if [ -x "$LOCAL_ATK" ]; then
    LOCAL_ATK_REAL="$(realpath_or_same "$LOCAL_ATK")"
  fi

  if [ -z "$PATH_ATK" ]; then
    echo "agent-trigger-kit PATH binary missing; status=path_not_found"
  else
    PATH_ATK_REAL="$(realpath_or_same "$PATH_ATK")"
    if [ -n "$LOCAL_ATK_REAL" ] && [ "$PATH_ATK_REAL" = "$LOCAL_ATK_REAL" ]; then
      echo "agent-trigger-kit PATH binary already tried as local package; status=path_duplicate_local"
    elif [ ! -f "$PIN_FILE" ]; then
      echo "agent-trigger-kit pin missing at $PIN_FILE; status=skipped_missing_pin"
    else
      PIN_REF="$(tr -d '[:space:]' < "$PIN_FILE")"
      PIN_VERSION="$(printf '%s' "$PIN_REF" | sed 's/^[vV]//')"
      if ! printf '%s' "$PIN_REF" | grep -Eq '^[vV]?[0-9]+\.[0-9]+\.[0-9]+$'; then
        echo "agent-trigger-kit PATH fallback skipped; status=path_non_semver_pin"
      else
        PATH_VERSION_RAW="$("$PATH_ATK" --version 2>/dev/null)"
        PATH_VERSION_STATUS="$?"
        PATH_VERSION="$(printf '%s' "$PATH_VERSION_RAW" | tr -d '[:space:]')"
        if [ "$PATH_VERSION_STATUS" -ne 0 ] || [ -z "$PATH_VERSION" ]; then
          echo "agent-trigger-kit PATH version unknown; status=path_version_unknown"
        elif [ "$PATH_VERSION" = "$PIN_VERSION" ]; then
          run_closeout_tier "$PATH_ATK" session-check --closeout --root "$ROOT"
        else
          echo "agent-trigger-kit PATH version mismatch; status=path_version_mismatch pin=$PIN_VERSION path=${PATH_VERSION:-unknown}"
        fi
      fi
    fi
  fi
fi

if [ "$CLOSEOUT_REPORT_SEEN" -eq 0 ]; then
  if [ ! -f "$PIN_FILE" ]; then
    echo "agent-trigger-kit pin missing at $PIN_FILE; status=skipped_missing_pin"
  else
    KIT_REF="$(tr -d '[:space:]' < "$PIN_FILE")"
    KIT_SPEC="github:${KIT_REPO}#$KIT_REF"
    run_closeout_tier npx --yes "$KIT_SPEC" session-check --closeout --root "$ROOT"
  fi
fi

if [ "$CLOSEOUT_REPORT_SEEN" -eq 1 ]; then
  exit "$CLOSEOUT_EXIT"
fi

exit 1
```

<!-- closeout-ladder:end -->

The canonical ladder intentionally runs `session-check --closeout` without
`--json`, so detecting `Session closeout check` is sufficient. If a future
version adds `--json`, update report detection to require both
`"kind": "session_check"` and `"mode": "closeout"`.

The ladder captures each tier's stderr with stdout and reprints the combined
output. This keeps sandbox, npm, and approval denial evidence in the transcript,
but long-running commands no longer stream progress live.

The `github:CCC0509/agent-trigger-kit#$KIT_REF` fallback is for harness docs and
test consumers only; product documentation should pin whatever distribution it
actually supports.

For Claude hooks, resolve the project root from `CLAUDE_PROJECT_DIR`, read the
installed package from `$CLAUDE_PROJECT_DIR/node_modules/.bin/agent-trigger-kit`,
read the pin from `$CLAUDE_PROJECT_DIR/.agent-trigger-kit/pin`, and pass
`--root "$CLAUDE_PROJECT_DIR"` to closeout commands. Do not assume the hook
current working directory is the project root.

If no closeout report appears:

- Installed package tier cannot resolve a local binary: note `not_installed`,
  then continue to PATH/global and pinned external tiers instead of treating
  that miss as a closeout failure.
- PATH/global binary missing: note `path_not_found`, then continue to pinned
  external.
- PATH/global binary resolves to the same file as the local package: note
  `path_duplicate_local`, then continue to pinned external.
- Missing pin before the PATH version gate or pinned external fallback: report
  `skipped_missing_pin` with the expected pin path.
- Non-semver pin: report `path_non_semver_pin` and continue to pinned external
  `npx`.
- PATH version command fails or prints no version: report `path_version_unknown`
  and continue to pinned external `npx`.
- PATH version differs from the normalized semver pin: report
  `path_version_mismatch` with the pin and PATH versions, then fall through to
  pinned external `npx --yes "$KIT_SPEC"`.
- Explicit host, sandbox, approval, or policy denial before any report: report
  `blocked_by_policy` with the denial evidence.
- Network, npm cache, package resolution, or unknown failures: report
  `invocation_error` with captured output.

When the denial signal is unclear, ambiguous no-report failures default to invocation_error.
That conservative fallback avoids hiding real command, npm, cache, network, or
package failures behind a policy label.

The compact Stop hook already runs only pinned external Tier 4, so this
correction changes the manual/prose ladder and consumer instructions rather
than the shipped example hook command.

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

For closeout, apply the closeout invocation policy above. If output contains
`Session closeout check`, treat closeout as having run and trust the report. If
no report appears, use `blocked_by_policy` only for explicit host, sandbox,
approval, or policy denial evidence; otherwise report `invocation_error` with
the captured output. Before reporting completion, follow the closeout invocation
policy. Prefer the local package, then a PATH/global `agent-trigger-kit` only
when `agent-trigger-kit --version` exactly matches the normalized semver pin.
Skip the PATH tier for non-semver pins and report
`status=path_non_semver_pin`. When the PATH version differs, report
`status=path_version_mismatch` and fall through to pinned external
`npx --yes "$KIT_SPEC"`.

For **Codex**, add a clearly-marked section to `AGENTS.md`:

```markdown
## Agent Trigger Kit checks

Use the version in `.agent-trigger-kit/pin`.

- Derive the local binary and pin before running checks:
  `ROOT="${ROOT:-.}"; LOCAL_ATK="$ROOT/node_modules/.bin/agent-trigger-kit"; PIN_FILE="$ROOT/.agent-trigger-kit/pin"`
- Derive `KIT_SPEC` before session-start and validate commands:
  `KIT_REF="$(tr -d '[:space:]' < "$PIN_FILE")"; KIT_SPEC="github:CCC0509/agent-trigger-kit#$KIT_REF"`
- For closeout, try `"$LOCAL_ATK" session-check --closeout --root "$ROOT"` only
  when `[ -x "$LOCAL_ATK" ]`; otherwise report
  `agent-trigger-kit local binary missing; status=not_installed`.
- If the local closeout binary is missing, require `PIN_FILE`. When it is
  missing, report `status=skipped_missing_pin`; otherwise follow the closeout
  invocation policy: try verified PATH/global `agent-trigger-kit` only when
  `agent-trigger-kit --version` exactly matches the normalized semver pin, skip
  PATH for non-semver pins and report `status=path_non_semver_pin`, report
  `status=path_version_mismatch` when the PATH version differs, then fall
  through to pinned external `npx --yes "$KIT_SPEC"`.
- At session start: `npx --yes "$KIT_SPEC" session-check --root .`
- After editing `.agents/`, `.claude-plugin/`, `.cursor/`, `.agent-trigger-kit/`,
  or `AGENTS.md`: `npx --yes "$KIT_SPEC" validate --root .`
- Before reporting completion: follow the closeout invocation policy above.
  Prefer the local package, then a PATH/global `agent-trigger-kit` only when
  `agent-trigger-kit --version` exactly matches the normalized semver pin. Skip
  the PATH tier for non-semver pins and report `status=path_non_semver_pin`.
  When the PATH version differs, report `status=path_version_mismatch` and fall
  through to pinned external `npx --yes "$KIT_SPEC"`.
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
`ROOT="${ROOT:-.}"`, `LOCAL_ATK="$ROOT/node_modules/.bin/agent-trigger-kit"`,
and `PIN_FILE="$ROOT/.agent-trigger-kit/pin"`. Then derive
`KIT_REF="$(tr -d '[:space:]' < "$PIN_FILE")"` and
`KIT_SPEC="github:CCC0509/agent-trigger-kit#$KIT_REF"` before session-start and
validate commands. Run `session-check` at session start and `validate` after
editing trigger surfaces (`.agents/`, `.claude-plugin/`, `.cursor/`,
`.agent-trigger-kit/`, `AGENTS.md`). Before reporting done, follow the closeout
invocation policy: use
`"$LOCAL_ATK" session-check --closeout --root "$ROOT"` only when
`[ -x "$LOCAL_ATK" ]`; otherwise report
`agent-trigger-kit local binary missing; status=not_installed`. If the local
closeout binary is missing, require `PIN_FILE`; when it is missing, report
`status=skipped_missing_pin`, otherwise prefer a PATH/global
`agent-trigger-kit` only when `agent-trigger-kit --version` exactly matches the
normalized semver pin. Skip the PATH tier for non-semver pins and report
`status=path_non_semver_pin`. When the PATH version differs, report
`status=path_version_mismatch` and fall through to pinned external
`npx --yes "$KIT_SPEC"`.
Record real failures with `outcome record`; never fabricate successes.
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
