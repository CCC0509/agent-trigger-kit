# Live Trigger Surface Checks Design

**Goal:** Add a consumer-owned, matrix-driven live drift check for generated
trigger layers, so Agent Trigger Kit can detect cross-surface installed-state
drift without hard-coding consuming projects or mutating user agent state by
default.

**Status:** Design spec. No runtime code has been changed by this spec.

## Context

Static validation already catches source-tree drift: generated manifests,
plugin manifests, wrappers, command shims, Cursor rules, canonical references,
and source version alignment. It cannot prove that live agent surfaces are still
aligned with those source files.

The recent Stock Scanner upgrade exposed the missing live evidence:

- Agent Trigger Kit source was current while Codex and Claude cache snapshots
  were stale.
- The Stock Scanner project plugin source was `0.1.5` while Claude project-scope
  cache still held `0.1.2`.
- Codex must not keep generated project plugins enabled globally, so live checks
  need negative assertions as well as positive version checks.

Those failures are not static repo bugs. They are runtime surface drift and need
a live-state probe that is explicit, read-only by default, and driven by a
consumer-owned contract.

## Decisions

### Matrix Is Structured Source, Markdown Is Generated

The live-check matrix is a YAML or JSON file, not a Markdown table. The
structured file is the source of truth and carries a `schemaVersion` field. Any
Markdown table used in README or runbooks is generated from that structured
matrix and is not parsed by the checker.

The first supported schema is `schemaVersion: 1`. A checker that does not
support the declared schema must fail with exit code `3` and a message such as
`unsupported matrix schemaVersion 2; upgrade Agent Trigger Kit`.

Within a supported schema version, unknown fields are allowed and preserved in
JSON output when practical. Unknown fields do not warn or fail validation in v1;
this keeps the schema forward-compatible without forcing a new `schemaVersion`
for every additive field.

### Consumers Own Their Matrix

Agent Trigger Kit owns the schema, reusable parser, live-check CLI, tests, and
optional starter template. Each consuming repo owns its matrix file and decides
which surfaces are in scope.

Default consumer path:

```text
.agent-trigger-kit/live-surfaces.yaml
```

The CLI accepts an explicit override:

```bash
agent-trigger-kit live-check \
  --root <consumer-repo> \
  --matrix <path-to-live-surfaces.yaml> \
  --plugin <plugin-name>
```

Agent Trigger Kit must not maintain a known-consumer list. Stock Scanner, or any
future consumer, wires its own npm script to call the reusable CLI with its own
matrix.

### Existing Version Logic Becomes Shared Library Code

The live-check CLI does not shell out to a skill and does not duplicate
`check-plugin-version.mjs` logic.

`scripts/lib/plugin-state-probe.mjs` already owns most installed-state probing,
including read-only Claude filesystem metadata. Implementation should extract
the remaining source-version assembly and consistency check from
`scripts/check-plugin-version.mjs` into a reusable library consumed by:

- `scripts/check-plugin-version.mjs`
- the `version-check` packaged CLI command
- the new `live-check` packaged CLI command
- Agent Trigger Kit skills, through instructions that call the CLI instead of
  reimplementing comparison logic in Markdown

The current `plugins/agent-trigger-kit/skills/version-check/SKILL.md` remains a
workflow wrapper. It should describe when to call `version-check` or
`live-check`; it should not become the implementation.

`claude-installed-plugin` must use filesystem metadata from Claude's plugin
state, such as `installed_plugins.json`, `known_marketplaces.json`, and install
cache paths. It must not invoke `claude plugin list --json` or any other Claude
CLI command in v1. The CLI path remains appropriate for manual discovery and for
existing `check-plugin-version` interactive behavior, but live-check's
headless-safe verifier is file-based.

### Live-Check Is Read-Only By Default

`live-check` must not update marketplaces, refresh caches, install plugins,
remove Codex config, or rewrite generated files by default. It reads source
manifests, cache metadata, config files, and CLI output only.

Future repair behavior is opt-in behind `--fix` or narrower flags. A read-only
check may print suggested commands, but it must not run them.

This preserves CI, hook, and operator predictability: running the check never
changes agent state unless the operator explicitly asks for mutation.

### Static And Live Gates Stay Separate

Static gates remain the CI-safe default:

```bash
agent-trigger-kit validate --root <consumer-repo>
agent-trigger-kit version-check --root <consumer-repo> --surface source <plugin-name>
```

Live checks are operator or release gates by default because they inspect
machine-local agent state. A future CI mode may run only rows marked
`headless: safe`, but the first version should not pretend every surface has
portable headless discovery.

## Matrix Schema

Example consumer matrix:

```yaml
schemaVersion: 1
plugin: stock-scanner-ops
canonicalPlaybook: docs/agent-playbooks/stock-scanner-ops.md
generatedManifest: .agent-trigger-kit/generated.json
generatedDocs:
  markdownTable: docs/agent-trigger-surfaces.md
defaults:
  timeoutMs: 20000
surfaces:
  - id: codex-user-agent-trigger-kit
    surface: codex
    scope: user
    plugin: agent-trigger-kit
    marketplace: agent-trigger-kit
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
    headless: safe
    owner: toolkit
    stalenessBudget:
      mode: none

  - id: claude-project-stock-scanner-ops
    surface: claude
    scope: project
    plugin: stock-scanner-ops
    marketplace: stock-scanner-ops
    artifactType: project-plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: claude-installed-plugin
    headless: safe
    owner: stock-scanner
    stalenessBudget:
      mode: none

  - id: codex-no-global-stock-scanner-ops
    surface: codex
    scope: user
    plugin: stock-scanner-ops
    marketplace: stock-scanner-ops
    artifactType: negative-config-assertion
    sourceTruth: allowlist
    liveVerifier:
      kind: codex-config-absence
      forbiddenPluginIds:
        - stock-scanner-ops@stock-scanner-ops
      forbiddenMarketplaces:
        - stock-scanner-ops
    headless: safe
    owner: stock-scanner
    stalenessBudget:
      mode: none

  - id: cursor-rules
    surface: cursor
    scope: repo
    plugin: stock-scanner-ops
    artifactType: static-rule
    sourceTruth: repo-files
    liveVerifier:
      kind: static-validator
    headless: safe
    owner: stock-scanner
    stalenessBudget:
      mode: none

  - id: gemini-pointer
    surface: gemini
    scope: repo
    plugin: stock-scanner-ops
    artifactType: pointer-doc
    sourceTruth: repo-files
    liveVerifier:
      kind: pointer-doc
    headless: safe
    owner: stock-scanner
    stalenessBudget:
      mode: pointer-only
      reason: Gemini generated trigger-layer templates are not implemented.
      until: 2026-06-30

assertions:
  - id: no-skill-command-name-collisions
    kind: component-name-disjoint
    plugin: stock-scanner-ops
    sets:
      - skills
      - commands
    onFailure: drift
    owner: toolkit
```

The top-level `plugin` is the default consumer plugin for rows that omit
`plugin`. A row may override it when the consumer matrix intentionally checks a
dependency surface, such as the user-scope Agent Trigger Kit install used to
operate the generated project layer.

Required top-level fields:

- `schemaVersion`
- `plugin`
- `surfaces`

Recommended top-level fields:

- `canonicalPlaybook`
- `generatedManifest`
- `generatedDocs`
- `defaults`
- `assertions`

Required surface fields:

- `id`
- `surface`
- `scope`
- `plugin`
- `artifactType`
- `sourceTruth`
- `liveVerifier`
- `headless`
- `owner`
- `stalenessBudget`

`defaults` may provide values for optional row fields only. It cannot satisfy
the required field list above unless the field explicitly says it supports a
default. In v1, `timeoutMs` supports top-level defaulting; `owner` must remain
explicit on every row so drift ownership is visible in review.

Required assertion fields:

- `id`
- `kind`
- `onFailure`
- `owner`

For `component-name-disjoint`, required assertion-specific fields are:

- `plugin`
- `sets`

`onFailure` is author intent, not runtime state. It accepts only `drift` and
`allowed-drift`. The runtime result still uses the normal result status
vocabulary (`clean`, `drift`, `allowed-drift`, `validation-error`, `timeout`).

## Field Semantics

`surface` is the agent or integration surface: `codex`, `claude`, `cursor`,
`gemini`, or a future explicit enum value.

`scope` describes where the state lives: `user`, `project`, `repo`, `managed`,
or `local`.

`artifactType` names the object being checked, such as `plugin-cache`,
`project-plugin-cache`, `static-rule`, `pointer-doc`, or
`negative-config-assertion`.

`sourceTruth` identifies what live state should match: `source-version`,
`repo-files`, `allowlist`, or an explicit future source.

`liveVerifier.kind` selects the probe implementation. Initial kinds:

- `codex-cache`: read Codex plugin cache directories and compare with source
  version.
- `codex-config-absence`: read Codex config and ensure forbidden project plugin
  IDs are absent.
- `claude-installed-plugin`: read Claude installed plugin metadata from files
  and compare scope, version, and expected project path. It does not call the
  Claude CLI.
- `static-validator`: delegate to the existing static validator for static-only
  surfaces.
- `pointer-doc`: check the pointer doc exists and has frontmatter
  `pointer_only: true`.

For `codex-cache`, `liveVerifier.codexHome` is optional and defaults to
`${CODEX_HOME:-~/.codex}`. For `claude-installed-plugin`,
`liveVerifier.claudeHome` is optional and defaults to
`${CLAUDE_HOME:-~/.claude}`. Both fields support the same environment expansion
rules documented in the CLI section. Committed consumer matrices should omit
these fields unless they intentionally target a non-default home.

For `claude-installed-plugin`, `liveVerifier.projectPath` is optional. When it
is omitted for a `scope: project` row, the expected project path is the resolved
`--root` path. When present, `projectPath` supports the same environment and
token expansion as home paths, including `${VAR}`, `${VAR:-fallback}`, `~`, and
`${ROOT}`. Committed consumer matrices should prefer omission or `${ROOT}` over
machine-specific absolute paths.

For `codex-config-absence`, `configPath` defaults to
`${CODEX_HOME:-~/.codex}/config.toml`. A missing config file is clean. An
unparsable config file is a validation error. The verifier checks active
configuration table names only; it does not scan comments or unrelated string
values.

Example forbidden global residue:

```toml
[marketplaces.stock-scanner-ops]
source = "/Users/example/projects/stock-scanner"

[plugins."stock-scanner-ops@stock-scanner-ops"]
enabled = true
```

`forbiddenPluginIds` match `[plugins."<plugin-id>"]` table names exactly.
`forbiddenMarketplaces` match `[marketplaces.<marketplace-name>]` table names
exactly. Future aliases may be added explicitly, but v1 does not infer partial
names from free-form config values.

`headless` is a declared capability, not an afterthought. Initial values:

- `safe`: can run without an interactive agent session by reading files or
  deterministic CLI JSON.
- `manual`: requires an operator session.
- `unknown`: not yet classified; live-check may report but should not fail CI
  on this row.

`owner` is the human or repo team responsible for resolving drift. Drift reports
group by owner so cross-repo checks do not end in ambiguity.

`stalenessBudget` prevents permanent ignore rules. Supported modes:

- `none`: any mismatch is drift.
- `allowed-until`: mismatch is accepted until an ISO date, then becomes drift.
- `pinned-version`: an explicit version is expected even if source is newer.
- `pointer-only`: a surface is intentionally not generated yet; must include
  `reason` and `until`.

Rows with allowed staleness still appear in JSON and human output as
`allowed-drift`, including the owner, reason, and expiration.

`pointer-only` is valid only with `artifactType: pointer-doc` and
`liveVerifier.kind: pointer-doc`. Using it on cache, config, or generated wrapper
rows is a matrix configuration error.

## Assertions

Assertions are matrix-level checks that are not tied to one runtime cache.

The first assertion kind is `component-name-disjoint`. It verifies that named
component sets do not share display names. For generated Claude plugins this
checks skill names and command shim names separately so a plugin does not create
the same component name twice.

Assertions use `onFailure` to say how a failed assertion is classified. Matrix
authors may set `onFailure: drift` or `onFailure: allowed-drift`; `clean`,
`validation-error`, and `timeout` are runtime result states and are invalid as
author declarations.

The Stock Scanner `stock-scanner-ops` project currently has eight skill wrappers
and eight command shims with the same names. Claude's `plugin details` output
flattens those into `Skills (16)`. That is not a duplicated source manifest, but
it is a component-name collision worth making visible. The assertion should
report it as drift unless the consumer matrix grants a temporary staleness
budget.

For existing consumers, a staleness budget may downgrade this collision to
`allowed-drift` for one release cycle. New matrices should treat the collision
as `drift` immediately.

## Output

Human output is the default and should be concise:

```text
Live trigger surface check: stock-scanner-ops

OK       codex-user-agent-trigger-kit        codex user     agent-trigger-kit 0.1.13
DRIFT    claude-project-stock-scanner-ops    claude project expected 0.1.5, found 0.1.2
OK       codex-no-global-stock-scanner-ops   codex user     no forbidden plugin ids found
ALLOWED  gemini-pointer                      gemini repo    pointer-only until 2026-06-30

Summary: 1 drift, 1 allowed drift, 3 clean
Owner: stock-scanner has 1 actionable drift
```

`--json` emits stable machine-readable output:

```json
{
  "schemaVersion": 1,
  "plugin": "stock-scanner-ops",
  "status": "drift",
  "summary": {
    "clean": 3,
    "drift": 1,
    "allowedDrift": 1,
    "validationErrors": 0,
    "timeouts": 0
  },
  "results": [
    {
      "id": "claude-project-stock-scanner-ops",
      "surface": "claude",
      "scope": "project",
      "owner": "stock-scanner",
      "status": "drift",
      "expected": "0.1.5",
      "actual": "0.1.2",
      "nextActions": [
        "claude plugin marketplace update stock-scanner-ops",
        "claude plugin update stock-scanner-ops@stock-scanner-ops --scope project"
      ]
    }
  ]
}
```

The JSON contract is guarded by tests for the stable keys `schemaVersion`,
`plugin`, `status`, `summary`, and `results[*].{id,surface,scope,owner,status}`.
Consumers should key on those stable fields, not free-form messages. Additive
fields are allowed and covered by JSON output tests.

## Exit Codes

Exit codes are intentionally distinct so hooks can soft-fail on drift while
hard-failing on broken configuration:

| Code | Meaning |
| --- | --- |
| 0 | Clean. No drift, validation errors, or timeouts. |
| 1 | Drift detected. State is actionable by an operator, and the matrix/config is valid. |
| 2 | Validation error. Source repo, manifests, or runtime metadata are broken or unparsable. |
| 3 | Live-check configuration or matrix schema error. Upgrade or repair the matrix/checker. |
| 124 | Timeout. A bounded live verifier exceeded its configured timeout. |

When multiple classes occur, the highest-precedence class wins: `124` beats `3`
beats `2` beats `1` beats `0`.

## Timeout Model

Every verifier that can invoke a CLI gets a timeout. The effective value is:

1. row-level `timeoutMs`
2. CLI flag `--timeout-ms`
3. top-level `defaults.timeoutMs`
4. environment variable `AGENT_TRIGGER_LIVE_CHECK_TIMEOUT_MS`
5. built-in default `20000`

Timeouts produce exit code `124` and a result status of `timeout`. They are not
collapsed into ordinary drift because operators need to distinguish "state is
stale" from "the verifier did not complete."

The v1 `claude-installed-plugin`, `codex-cache`, and `codex-config-absence`
verifiers are filesystem probes and do not normally need a timeout. Timeout
support still belongs in the shared verifier harness for static validator
delegation and future CLI-backed probes.

## CLI Interface

Packaged CLI:

```bash
agent-trigger-kit live-check \
  --root <consumer-repo> \
  --matrix .agent-trigger-kit/live-surfaces.yaml \
  --plugin <plugin-name>
```

If `--matrix` is omitted, `live-check` reads
`.agent-trigger-kit/live-surfaces.yaml` under `--root`.

Package script in Agent Trigger Kit:

```json
{
  "scripts": {
    "ops:live-check": "node scripts/live-trigger-surface-check.mjs"
  }
}
```

Consumer package script example:

```json
{
  "scripts": {
    "ops:agent-triggers:live-check": "agent-trigger-kit live-check --root . --matrix .agent-trigger-kit/live-surfaces.yaml --plugin stock-scanner-ops"
  }
}
```

Important flags:

- `--json`: print JSON only.
- `--headless-only`: run rows with `headless: safe`; report skipped rows.
- `--owner <owner>`: run or summarize rows for one owner.
- `--timeout-ms <ms>`: override default timeout.
- `--strict-allowed-drift`: return drift for expired and unexpired allowed
  drift, useful before release.
- `--fix`: reserved for future opt-in repair. The v1 implementation may reject
  it with a clear "not implemented" message.

If filters such as `--headless-only` and `--owner` select zero rows,
`live-check` exits `0` and prints `no rows selected`.

Environment expansion is POSIX-style in v1: `${VAR}`, `${VAR:-fallback}`, `~`,
and `${ROOT}` are supported. Windows-native expansion syntax is out of scope
until Windows support is explicitly tested.

## Generated Markdown Table

Agent Trigger Kit should provide a separate rendering command:

```bash
agent-trigger-kit render-matrix \
  --root <consumer-repo> \
  --matrix .agent-trigger-kit/live-surfaces.yaml \
  --output docs/agent-trigger-surfaces.md
```

Rendering is a write operation and is intentionally separate from the read-only
`live-check` command.

The generated table is for humans. It should include at least:

| Surface | Scope | Artifact | Source Truth | Live Verifier | Headless | Owner | Staleness Budget |
| --- | --- | --- | --- | --- | --- | --- | --- |

The checker never parses this table. If the generated Markdown is stale, the
checker reports that as a source validation issue by comparing regenerated bytes
when `generatedDocs.markdownTable` is configured. The YAML/JSON matrix remains
canonical.

## Hook And Release Integration

V1 should wire checks in this order:

1. Static source validation in CI and pre-merge:
   `validate`, `version-check --surface source`, and existing
   `ops:premerge-version-check`.
2. Static matrix schema validation:
   if `.agent-trigger-kit/live-surfaces.yaml` exists, `validate` checks its
   schema, duplicate IDs, verifier kinds, staleness budget shape, and static
   cross-field constraints without reading user-level agent state. If
   `generatedDocs.markdownTable` is configured, `validate` also checks generated
   Markdown freshness.
3. Consumer release/operator step:
   `ops:agent-triggers:live-check`.
4. Optional future hook:
   `--headless-only` can run locally or in CI if every selected row is declared
   headless-safe and the environment has the required cache/config paths.

The release checklist should not add a separate human step for "check project
plugin stale." That requirement is one row in the matrix and one failing
live-check result.

## Error Handling

Matrix parse failure, unsupported schema, missing required fields, duplicate row
IDs, unknown verifier kinds, malformed staleness budgets, `pointer-only` on a
non-pointer row, and invalid assertion `onFailure` values are configuration
errors and exit `3`.

Source manifest inconsistency, broken generated manifest, unparsable Claude
metadata, invalid Codex config syntax, static validator failure, or stale
generated Markdown table exits `2`.

Observed stale versions, missing expected cache versions, unexpected project
scope, forbidden Codex project plugin IDs, and component-name collisions exit
`1` unless covered by an active staleness budget.

CLI timeouts exit `124` even when other drift was also found.

## Security And Privacy

Live-check must not print secret values. It may print config file paths,
plugin IDs, versions, scopes, project paths, and suggested commands.

The Codex negative assertion reads config keys only; it should not dump the full
config file. Claude probes should report plugin metadata, not raw settings
contents.

## Non-Goals

- Do not make Agent Trigger Kit know about every consuming repo.
- Do not parse Markdown tables as machine input.
- Do not mutate user-level agent state in read-only mode.
- Do not make live-check a replacement for static validation.
- Do not claim Gemini generated trigger-layer support until templates and
  validator rules exist.
- Do not require Cursor runtime discovery; Cursor remains static-only in this
  toolkit.

## Implementation Outline

1. Add `scripts/lib/live-surface-matrix.mjs` for schema parsing, defaulting,
   env expansion for home paths, duplicate-ID detection, staleness budget
   evaluation, and generated Markdown rendering.
2. Extract source-version assembly and consistency checking from
   `scripts/check-plugin-version.mjs` into reusable library functions. Reuse
   existing installed-state probes from `scripts/lib/plugin-state-probe.mjs`.
   Keep the existing CLI behavior unchanged.
3. Add `scripts/live-trigger-surface-check.mjs` and expose it through
   `scripts/cli.mjs` as `live-check`.
4. Add verifier implementations for `codex-cache`, `codex-config-absence`,
   `claude-installed-plugin`, `static-validator`, and `pointer-doc`.
5. Add assertion implementations for `component-name-disjoint`.
6. Teach `validate` to schema-check `.agent-trigger-kit/live-surfaces.yaml`
   when present, without reading user-level agent state.
7. Add focused `node:test` coverage for schema validation, exit-code
   precedence, staleness budgets, timeout behavior, JSON output, read-only
   default behavior, and collision detection.
8. Add a template matrix at `docs/examples/live-surfaces.yaml`, but do not add
   hard-coded consumer rows to Agent Trigger Kit. Do not add a separate
   `matrix init` command in v1; the existing trigger-layer init flow and the
   documented template are sufficient.
9. Update `README.md`, `cross-agent-trigger-layer`, and `version-check` skill
   wrappers to point operators at the matrix-driven live-check workflow.
10. Bump the aligned Agent Trigger Kit plugin version through the existing
   premerge/version reconciliation workflow because CLI scripts and
   plugin-visible skill instructions change.

## Verification Plan

Unit tests:

- Matrix schema accepts the documented example and rejects missing required
  fields, unknown verifier kinds, duplicate row IDs, and unsupported schemas.
- Matrix schema allows unknown additive fields for supported schemas.
- Assertions reject invalid `onFailure` values such as `clean` or `timeout`.
- Staleness budgets convert mismatches into `allowed-drift` only until their
  expiration date.
- `pointer-only` is rejected unless the row is a pointer-doc row.
- Exit code precedence returns `124 > 3 > 2 > 1 > 0`.
- Read-only mode does not call update, install, remove, or cache sync commands.
- `component-name-disjoint` reports skill/command collisions.
- JSON output is stable and contains owner, surface, scope, status, expected,
  actual, and nextActions where relevant.
- JSON output preserves additive fields without breaking the stable contract.

Integration-style tests with temporary homes:

- Codex cache present/missing versions.
- Codex config absence allowlist.
- Claude installed plugin present/stale/projectPath mismatch using temporary
  `installed_plugins.json`, without invoking the Claude CLI.
- Pointer doc verification requires frontmatter `pointer_only: true`.
- Static-only Cursor and pointer-only Gemini rows.

Manual verification on a real consumer:

```bash
agent-trigger-kit validate --root <consumer-root>
agent-trigger-kit version-check --root <consumer-root> --surface source <plugin-name>
agent-trigger-kit live-check --root <consumer-root> --matrix .agent-trigger-kit/live-surfaces.yaml --plugin <plugin-name>
```

Expected: clean when Codex has no global generated project plugin residue and
Claude project cache matches the source manifest; drift when either condition is
manually mocked stale.

`nextActions` in live-check output are operator suggestions. Read-only verifiers
may print commands such as `claude plugin update ...`, but they never execute
those commands unless a future explicit repair mode is implemented and invoked.
