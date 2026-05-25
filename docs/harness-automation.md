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

## Claude Code hooks (consumer repo)

Write this to the consumer repo's `.claude/settings.local.json` and add
`.claude/settings.local.json` to `.gitignore`. Replace `<tag>` with a pinned tag
or commit — match the `KIT_SPEC` you already use for CI validation.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx --yes github:CCC0509/agent-trigger-kit#<tag> session-check --root \"$CLAUDE_PROJECT_DIR\" || true",
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
            "command": "node -e 'let d=\"\";process.stdin.on(\"data\",c=>d+=c);process.stdin.on(\"end\",()=>{let i={};try{i=JSON.parse(d)}catch{}const f=(i.tool_input&&i.tool_input.file_path)||\"\";const hit=[\"/.agents/\",\"/.claude-plugin/\",\"/.cursor/\",\"/.agent-trigger-kit/\"].some(s=>f.includes(s))||f.endsWith(\"/AGENTS.md\");if(hit){const cp=require(\"child_process\");const dir=process.env.CLAUDE_PROJECT_DIR||\".\";const r=cp.spawnSync(\"npx\",[\"--yes\",\"github:CCC0509/agent-trigger-kit#<tag>\",\"validate\",\"--root\",dir],{stdio:\"inherit\"});process.exit(r.status||0)}})'",
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
            "command": "npx --yes github:CCC0509/agent-trigger-kit#<tag> session-check --closeout --root \"$CLAUDE_PROJECT_DIR\" || true",
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
npm i -D github:CCC0509/agent-trigger-kit#<tag>
```

Then call `npx agent-trigger-kit ...` (resolves from `node_modules/.bin`) in the
hooks instead of `npx --yes github:...`, and change the `PostToolUse`
`spawnSync` arguments to `["agent-trigger-kit","validate","--root",dir]`.

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
version-check guidance in the README. `live-check` stays a manual operator or
release gate because it inspects local installed Codex/Claude state, which CI
cannot see.
