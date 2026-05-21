# Opt-In Document Header Checks Design

Status: Draft

**Goal:** Add a generic, config-driven document header checker to the existing
trigger-layer validator so projects can opt in to lifecycle headers without
making Agent Trigger Kit depend on Superpowers.

**Status:** Design spec. No runtime code has been changed by this spec.

## Problem

Projects that use spec and plan workflows often need a small, scannable status
header at the top of each lifecycle document. The first concrete use case is
Superpowers plan/spec files that include a `Status: ...` line near the top.
Stock Scanner has a local `head -6` shell loop for a similar policy, which is a
sign that the behavior belongs in the shared trigger-layer validator.

Agent Trigger Kit must not become Superpowers-specific. The kit should provide
only the generic mechanism: find files by glob, inspect the first N lines, and
require a configured regular expression to match at least one of those lines.
Projects own the policy, including lifecycle status names.

## Non-Negotiables

- The feature is opt-in. If no config is committed, validation behaves exactly
  as it does today.
- There is no `enabled: true` boolean. The presence of a non-empty
  `headerChecks` section is the switch.
- The implementation lives under the existing `agent-trigger-kit validate`
  entry point.
- The config lives in the manifest the validator already reads:
  `.agent-trigger-kit/generated.json`.
- Agent Trigger Kit does not hard-code Superpowers paths, status enums, or
  workflow assumptions into validator logic.
- `init` can scaffold an inactive example and can write the active Superpowers
  config only when an explicit flag asks for that output.

## Manifest Shape

Store checks on each generated plugin entry in `.agent-trigger-kit/generated.json`.
This matches the current schema v2 structure and the existing init/write path,
which is plugin-scoped.

```json
{
  "schemaVersion": 2,
  "plugins": {
    "project-ops": {
      "pluginVersion": "0.1.0",
      "playbook": "docs/agent-playbooks/project-ops.md",
      "maintenanceContract": ".agent-trigger-kit/MAINTENANCE.md",
      "tasks": ["docs-review"],
      "files": [],
      "headerChecks": [
        {
          "name": "superpowers-plan-lifecycle",
          "globs": ["docs/superpowers/specs/*.md", "docs/superpowers/plans/*.md"],
          "headerLines": 6,
          "requirePattern": "^Status: ",
          "exclude": ["docs/plans/**"]
        }
      ]
    }
  }
}
```

Schema v1 generated manifests are treated as a single plugin entry, as they are
today. If a v1 manifest already contains `headerChecks`, normalization should
carry it forward into the v2 shape.

The validator must validate `headerChecks` from the raw generated manifest
entry before relying on normalized plugin entries. This keeps malformed
top-level shapes such as `"headerChecks": {}` from being silently treated as
absent by normalization.

While iterating raw v2 plugin entries, the header-check path should ignore
non-object plugin entries instead of dereferencing them. General generated
manifest schema hardening for shapes such as `"plugins": { "x": null }` is an
existing validator concern and remains outside this feature.

## Config Fields

- `name`: non-empty string used in failure messages.
- `globs`: non-empty array of string path globs, relative to the validation
  root.
- `headerLines`: positive integer. The validator reads only this many top
  lines from each matched file.
- `requirePattern`: non-empty JavaScript regular expression source string.
  The validator compiles it without flags and tests each inspected header line.
- `exclude`: optional array of string path globs, relative to the validation
  root.

No `allowedValues` field is added. Projects that need enum validation express
it in `requirePattern`, for example:

```json
{
  "requirePattern": "^Status: (Draft|Approved|Implemented|Deployed|Observing|Superseded|Archived)$"
}
```

## Validation Behavior

When `.agent-trigger-kit/generated.json` is missing, has no plugin entries, or
has no `headerChecks` entries, the new validator path returns without doing
work.

For each configured check:

1. Expand all `globs` against files under the validation root.
2. Remove files matched by `exclude`.
3. For each remaining file, read the first `headerLines` lines.
4. If no inspected line matches `requirePattern`, add:

   ```text
   MISSING header in <file> (check: <name>)
   ```

Malformed config fails validation with a manifest-path error before file checks
run for that entry. Invalid regexes fail validation with the regex error
message. Empty glob results are allowed so new projects can opt in before their
first spec or plan exists.

The single `MISSING header` failure shape is intentional. A project can use
`requirePattern` for enum validation, and a present-but-invalid value such as
`Status: Banana` will still report as `MISSING header ...` because no inspected
line matched the required header pattern.

## Glob Semantics

Use a small local glob matcher instead of adding a runtime dependency.

- Normalize all paths to forward slashes.
- Support `*` within one path segment.
- Support `**` across path segments.
- Support `?` for one non-slash character.
- Walk regular files under the root while pruning `.git` and `node_modules`.
- Use `lstat` and skip symlinks during the walk so a symlinked directory cannot
  create an accidental recursive scan.
- Cache the file walk per checked plugin so multiple configured checks do not
  rescan the full tree repeatedly.

This is enough for the intended committed config and future Stock Scanner
migration without growing the dependency surface.

## Init Behavior

Default `init` behavior remains conservative:

- Generated manifests do not include active `headerChecks`.
- New `.agent-trigger-kit/MAINTENANCE.md` files include a commented Markdown
  example showing how to copy a `headerChecks` block into
  `.agent-trigger-kit/generated.json`.

Add `init --with-superpowers-gate` for non-interactive greenfield setup. The
flag writes the active Superpowers-oriented `headerChecks` block into the
generated plugin entry. The flag is not persisted as a boolean; only the
manifest output matters.

Do not auto-detect `docs/superpowers/` on every run. Re-running `init` should
preserve committed config through `upsertGeneratedPluginEntry()` instead of
re-deciding policy from directory shape.

## Documentation

Update:

- `README.md`: document the generic opt-in header check, the Superpowers
  example, and the `--with-superpowers-gate` init flag.
- `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md`:
  mention that trigger-layer validation can also enforce configured document
  headers.
- `plugins/agent-trigger-kit/commands/trigger-layer-init.md`: mention the
  explicit flag for greenfield Superpowers workflows.
- `plugins/agent-trigger-kit/commands/trigger-layer-validate.md`: mention the
  `MISSING header in ...` failure class.
- `CHANGELOG.md`: add the release note.

Those plugin-visible file changes require an aligned patch version bump across
`package.json`, `package-lock.json`, Codex marketplace, Codex plugin manifest,
Claude marketplace, and Claude plugin manifest before completion.

## Test Strategy

Use TDD in `tests/trigger-layer-scripts.test.mjs`.

Coverage should include:

- `headerChecks` absent: validation stays no-op.
- `headerChecks` present but not an array: validation fails with a manifest-path
  config error.
- Matching header in line 1 through `headerLines`: validation passes.
- Missing header: validation fails with
  `MISSING header in <file> (check: <name>)`.
- Body-only status after `headerLines`: validation fails.
- `exclude` removes legacy files from the checked set.
- Regex enum policies work through `requirePattern`.
- Invalid config reports manifest errors.
- Invalid regex reports manifest errors.
- `init` without the flag writes no active `headerChecks`.
- `init --with-superpowers-gate` writes the active Superpowers check.
- Existing `headerChecks` survive re-init through generated manifest
  normalization/upsert.
- A v1 generated manifest with `headerChecks` carries the array forward during
  normalization.
- Symlinked directories are skipped during glob expansion.

## Out Of Scope

- No Superpowers dependency.
- No auto-enablement for existing projects.
- No hard-coded Superpowers lifecycle enum.
- No Stock Scanner migration in this repository change.
- No parallel config file outside `.agent-trigger-kit/generated.json`.
- No general generated manifest schema hardening beyond avoiding a new
  header-check-specific null dereference.

## Resolved Open Questions

- **Which manifest?** `.agent-trigger-kit/generated.json`, because the
  validator already reads it and generated project trigger layers already
  commit it.
- **Where in the manifest?** Plugin entry `headerChecks`, because schema v2 is
  plugin-scoped and init/writeTriggerLayer already upsert one plugin at a time.
- **Section name?** `headerChecks`, matching the handoff schema and the generic
  mechanism.
- **Allowed values?** Not first-class. Use `requirePattern`.
- **Monorepo/non-standard docs paths?** The kit does not infer them. Consumers
  commit explicit `globs` and `exclude` values.
