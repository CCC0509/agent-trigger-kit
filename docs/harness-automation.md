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
            "command": "sh -lc 'ROOT=\"${CLAUDE_PROJECT_DIR:-.}\"; LOCAL_ATK=\"$ROOT/node_modules/.bin/agent-trigger-kit\"; PIN_FILE=\"$ROOT/.agent-trigger-kit/pin\"; PIN_REF=\"$(tr -d \"[:space:]\" < \"$PIN_FILE\" 2>/dev/null || true)\"; PATH_ATK=\"$(command -v agent-trigger-kit 2>/dev/null || true)\"; atk_run(){ if [ -x \"$LOCAL_ATK\" ]; then \"$LOCAL_ATK\" \"$@\"; return $?; fi; if ! printf \"%s\" \"$PIN_REF\" | grep -Eq \"^[vV]?[0-9]+\\.[0-9]+\\.[0-9]+$\"; then return 126; fi; PIN_VERSION=\"$(printf \"%s\" \"$PIN_REF\" | sed \"s/^[vV]//\")\"; if [ -n \"$PATH_ATK\" ] && [ \"$(\"$PATH_ATK\" --version 2>/dev/null | tr -d \"[:space:]\")\" = \"$PIN_VERSION\" ]; then \"$PATH_ATK\" \"$@\"; return $?; fi; return 127; }; run_advisory(){ LABEL=\"$1\"; shift; atk_run \"$@\"; rc=\"$?\"; case \"$rc\" in 0) ;; 126) echo \"agent-trigger-kit $LABEL not run; status=path_non_semver_pin\" ;; 127) echo \"agent-trigger-kit $LABEL not run; status=interactive_skipped_local_first\" ;; *) echo \"agent-trigger-kit $LABEL failed; exit=$rc\" ;; esac; }; if [ ! -f \"$PIN_FILE\" ]; then echo \"agent-trigger-kit pin missing at $PIN_FILE; skipping optional harness check\"; exit 0; fi; run_advisory session-check session-check --root \"$ROOT\"; run_advisory pin-check pin-check --no-outcome --root \"$ROOT\"; exit 0'",
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
            "command": "sh -lc 'ATK_STRICT_VALIDATE=\"${ATK_STRICT_VALIDATE:-0}\"; if ! command -v node >/dev/null 2>&1; then echo \"node missing; cannot parse PostToolUse payload; status=interactive_validate_unverified\"; [ \"$ATK_STRICT_VALIDATE\" = \"1\" ] && exit 1 || exit 0; fi; payload=\"$(cat)\"; file=\"$(printf \"%s\" \"$payload\" | node -e \"let d=String();process.stdin.on(\\\"data\\\",c=>d+=c);process.stdin.on(\\\"end\\\",()=>{try{const i=JSON.parse(d);process.stdout.write((i.tool_input&&i.tool_input.file_path)||String())}catch{}})\")\"; case \"$file\" in *\"/.agents/\"*|*\"/.claude-plugin/\"*|*\"/.cursor/\"*|*\"/.agent-trigger-kit/\"*|*\"/AGENTS.md\"|\"AGENTS.md\") ;; *) exit 0 ;; esac; ROOT=\"${CLAUDE_PROJECT_DIR:-.}\"; LOCAL_ATK=\"$ROOT/node_modules/.bin/agent-trigger-kit\"; PIN_FILE=\"$ROOT/.agent-trigger-kit/pin\"; PIN_REF=\"$(tr -d \"[:space:]\" < \"$PIN_FILE\" 2>/dev/null || true)\"; PATH_ATK=\"$(command -v agent-trigger-kit 2>/dev/null || true)\"; atk_run(){ if [ -x \"$LOCAL_ATK\" ]; then \"$LOCAL_ATK\" \"$@\"; return $?; fi; if ! printf \"%s\" \"$PIN_REF\" | grep -Eq \"^[vV]?[0-9]+\\.[0-9]+\\.[0-9]+$\"; then return 126; fi; PIN_VERSION=\"$(printf \"%s\" \"$PIN_REF\" | sed \"s/^[vV]//\")\"; if [ -n \"$PATH_ATK\" ] && [ \"$(\"$PATH_ATK\" --version 2>/dev/null | tr -d \"[:space:]\")\" = \"$PIN_VERSION\" ]; then \"$PATH_ATK\" \"$@\"; return $?; fi; return 127; }; if [ ! -f \"$PIN_FILE\" ]; then echo \"agent-trigger-kit pin missing at $PIN_FILE; skipping optional harness check\"; [ \"$ATK_STRICT_VALIDATE\" = \"1\" ] && exit 1 || exit 0; fi; atk_run validate --root \"$ROOT\"; rc=\"$?\"; case \"$rc\" in 0) exit 0 ;; 126) echo \"agent-trigger-kit validate not run; status=path_non_semver_pin\" ;; 127) echo \"agent-trigger-kit validate NOT RUN; status=interactive_validate_unverified\" ;; *) echo \"agent-trigger-kit validate FAILED; exit=$rc\"; exit \"$rc\" ;; esac; [ \"$ATK_STRICT_VALIDATE\" = \"1\" ] && exit 1 || exit 0'",
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
            "command": "sh -lc 'ROOT=\"${CLAUDE_PROJECT_DIR:-.}\"; LOCAL_ATK=\"$ROOT/node_modules/.bin/agent-trigger-kit\"; PIN_FILE=\"$ROOT/.agent-trigger-kit/pin\"; PIN_REF=\"$(tr -d \"[:space:]\" < \"$PIN_FILE\" 2>/dev/null || true)\"; PATH_ATK=\"$(command -v agent-trigger-kit 2>/dev/null || true)\"; atk_run(){ if [ -x \"$LOCAL_ATK\" ]; then \"$LOCAL_ATK\" \"$@\"; return $?; fi; if ! printf \"%s\" \"$PIN_REF\" | grep -Eq \"^[vV]?[0-9]+\\.[0-9]+\\.[0-9]+$\"; then return 126; fi; PIN_VERSION=\"$(printf \"%s\" \"$PIN_REF\" | sed \"s/^[vV]//\")\"; if [ -n \"$PATH_ATK\" ] && [ \"$(\"$PATH_ATK\" --version 2>/dev/null | tr -d \"[:space:]\")\" = \"$PIN_VERSION\" ]; then \"$PATH_ATK\" \"$@\"; return $?; fi; return 127; }; if [ ! -f \"$PIN_FILE\" ]; then echo \"agent-trigger-kit pin missing at $PIN_FILE; skipping optional harness check\"; exit 0; fi; atk_run session-check --closeout --root \"$ROOT\"; rc=\"$?\"; case \"$rc\" in 0) ;; 126) echo \"agent-trigger-kit closeout not run; status=path_non_semver_pin\" ;; 127) echo \"agent-trigger-kit closeout not run; status=interactive_skipped_local_first\" ;; *) echo \"agent-trigger-kit closeout failed; exit=$rc\" ;; esac; exit 0'",
            "statusMessage": "agent-trigger-kit closeout"
          }
        ]
      }
    ]
  }
}
```

The `PostToolUse` command reads the hook payload from stdin, extracts
`tool_input.file_path` with Node, and only runs `validate` when the path touches
a trigger surface (`.agents/`, `.claude-plugin/`, `.cursor/`,
`.agent-trigger-kit/`, or `AGENTS.md`). Every other edit is a silent no-op.
Missing local/PATH kit binaries warn and exit 0 by default; set
`ATK_STRICT_VALIDATE=1` inline in the hook command when an operator wants missing
interactive validation to block edits. A real `validate` failure still exits
with the kit's status in both modes.

### Activation caveat

Claude Code's settings watcher only watches `.claude/` if a settings file was
present there when the session started. After creating
`.claude/settings.local.json` for the first time, open `/hooks` once (reloads
config) or restart the session — otherwise the settings hooks do not fire in the
current session.

### Speed note

`PostToolUse` fires often. Install the kit locally to make the interactive hooks
use `node_modules/.bin/agent-trigger-kit` without touching the network:

```bash
KIT_REF="$(tr -d '[:space:]' < .agent-trigger-kit/pin)"
npm i -D "github:CCC0509/agent-trigger-kit#$KIT_REF"
```

Non-Node consumer repos can instead use a PATH/global `agent-trigger-kit`, but
only one global version can be active at a time. If repo A pins `0.2.9` and repo
B pins `0.2.10`, one repo's PATH tier will mismatch and the interactive helper
will skip it. Treat PATH version equality as convenience, not pinned-ref proof;
CI remains the integrity baseline.

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

capture_command_output() {
  CAPTURE_ERREXIT=0
  case $- in
    *e*)
      CAPTURE_ERREXIT=1
      set +e
      ;;
  esac

  CAPTURE_OUTPUT="$("$@" 2>&1)"
  CAPTURE_STATUS="$?"

  if [ "$CAPTURE_ERREXIT" -eq 1 ]; then
    set -e
  fi
  return 0
}

run_closeout_tier() {
  if [ "$CLOSEOUT_REPORT_SEEN" -eq 1 ]; then
    return 0
  fi

  capture_command_output "$@"
  CLOSEOUT_OUTPUT="$CAPTURE_OUTPUT"
  CLOSEOUT_EXIT="$CAPTURE_STATUS"
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
        capture_command_output "$PATH_ATK" --version
        PATH_VERSION_RAW="$CAPTURE_OUTPUT"
        PATH_VERSION_STATUS="$CAPTURE_STATUS"
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

The ladder temporarily disables `errexit` while capturing command output, then
restores it, so nonzero closeout reports still print and set the first-report
marker under `set -e`. It captures each tier's stderr with stdout and reprints
the combined output. This keeps sandbox, npm, and approval denial evidence in
the transcript, but long-running commands no longer stream progress live.

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

The compact Stop hook is advisory and now uses only the local/PATH interactive
helper. Operators who need pinned external closeout proof can run the canonical
ladder manually.

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

````markdown
## Agent Trigger Kit checks

Use the version in `.agent-trigger-kit/pin`.

- Define this interactive local-first helper before session-start, pin-check,
  validate, or outcome commands:

  ```sh
  ROOT="${ROOT:-.}"
  LOCAL_ATK="$ROOT/node_modules/.bin/agent-trigger-kit"
  PIN_FILE="$ROOT/.agent-trigger-kit/pin"
  PIN_REF="$(tr -d '[:space:]' < "$PIN_FILE" 2>/dev/null || true)"
  PATH_ATK="$(command -v agent-trigger-kit 2>/dev/null || true)"

  atk_run() {
    if [ -x "$LOCAL_ATK" ]; then "$LOCAL_ATK" "$@"; return $?; fi
    if ! printf '%s' "$PIN_REF" | grep -Eq '^[vV]?[0-9]+\.[0-9]+\.[0-9]+$'; then return 126; fi
    PIN_VERSION="$(printf '%s' "$PIN_REF" | sed 's/^[vV]//')"
    if [ -n "$PATH_ATK" ] && [ "$("$PATH_ATK" --version 2>/dev/null | tr -d '[:space:]')" = "$PIN_VERSION" ]; then
      "$PATH_ATK" "$@"; return $?
    fi
    return 127
  }

  run_advisory() {
    label="$1"; shift
    atk_run "$@"; rc="$?"
    case "$rc" in
      0) ;;
      126) echo "agent-trigger-kit $label not run; status=path_non_semver_pin" ;;
      127) echo "agent-trigger-kit $label not run; status=interactive_skipped_local_first" ;;
      *) echo "agent-trigger-kit $label failed; exit=$rc" ;;
    esac
  }

  run_validate() {
    atk_run validate --root "$ROOT"
    rc="$?"
    case "$rc" in
      0) ;;
      126) echo "agent-trigger-kit validate not run; status=path_non_semver_pin"; return 126 ;;
      127) echo "agent-trigger-kit validate NOT RUN; status=interactive_validate_unverified"; return 127 ;;
      *) echo "agent-trigger-kit validate FAILED; exit=$rc"; return "$rc" ;;
    esac
  }
  ```

- At session start, run `run_advisory session-check session-check --root "$ROOT"`
  and `run_advisory pin-check pin-check --no-outcome --root "$ROOT"`.
- After editing `.agents/`, `.claude-plugin/`, `.cursor/`, `.agent-trigger-kit/`,
  or `AGENTS.md`, run `run_validate`. If it prints
  `interactive_validate_unverified` or `path_non_semver_pin`, the final report
  MUST include a verification gap listing the affected files, and MUST NOT claim
  the trigger surface was validated. If it prints `validate FAILED`, preserve
  that failure as a real validation failure.
- Before reporting completion: follow the closeout invocation policy above.
  Prefer the local package, then a PATH/global `agent-trigger-kit` only when
  `agent-trigger-kit --version` exactly matches the normalized semver pin. Skip
  the PATH tier for non-semver pins and report `status=path_non_semver_pin`.
  When the PATH version differs, report `status=path_version_mismatch` and fall
  through to pinned external `npx --yes "$KIT_SPEC"`.
- Record real failures (skill missing, stale cache, wrong command) with
  `atk_run outcome record ...`. If the helper returns 126 or 127, report
  `status=interactive_outcome_unavailable`; if the command itself fails, report
  the real exit code. Never fabricate successes.
````

For **Cursor**, add `.cursor/rules/agent-trigger-kit.mdc` carrying the same four
instructions:

```markdown
---
description: Agent Trigger Kit checks
alwaysApply: true
---

Use the version in `.agent-trigger-kit/pin`. Use the same interactive helper as
AGENTS.md: define `ROOT`, `LOCAL_ATK`, `PIN_FILE`, `PIN_REF`, `PATH_ATK`,
`atk_run()`, `run_advisory()`, and `run_validate()`. Run
`run_advisory session-check session-check --root "$ROOT"` and
`run_advisory pin-check pin-check --no-outcome --root "$ROOT"` at session start.
After editing trigger surfaces (`.agents/`, `.claude-plugin/`, `.cursor/`,
`.agent-trigger-kit/`, `AGENTS.md`), run `run_validate`; its `case "$rc" in`
dispatch must keep real validation failures as `validate FAILED; exit=$rc`, while
126 reports `status=path_non_semver_pin` and 127 reports
`status=interactive_validate_unverified`. If validation is unverified, the final
report must list affected files as a verification gap and must not claim the
trigger surface was validated. Before reporting done, follow the closeout
invocation policy. Record real failures with `atk_run outcome record ...`;
unavailable interactive outcome recording reports
`status=interactive_outcome_unavailable`. Never fabricate successes.
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
pin in CI. Keep this pinned external package execution in CI: it is the
integrity baseline, while interactive local-first helpers are only a sandbox
ergonomics layer.

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
