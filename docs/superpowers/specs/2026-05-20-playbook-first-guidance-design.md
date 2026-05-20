# Playbook-First Guidance Design

**Goal:** Add a project-local playbook-first signal to generated trigger-layer skills and let `init` accept richer task descriptions, so project skills are easier to discover and agents see that the project playbook is the source of truth for covered tasks.

**Status:** Design spec for Tier 1 implementation. No code has been changed by this spec.

## Problem

Agent Trigger Kit generates thin project-local trigger wrappers. Today, generated `init` skill descriptions are very sparse:

```text
Use for <task> work in this repo.
```

That makes project-local skills weaker during discovery than generic/global skills with richer descriptions. The collision happens before a skill body is loaded, so adding more wording only inside the body is not enough.

There are two separate levers:

- `--task-descriptions` supplies task-specific trigger words and is the main discovery improvement for `init`-generated skills.
- The short playbook-first signal is a tie-breaker and precedence hint when a project skill and a generic/global helper both appear relevant.

The generated skill description needs the short signal, while the body can carry the fuller guidance.

This is not a Stock Scanner-specific issue. It is a generic project-local trigger layer versus global helper skill collision.

## Design Principles

- The project playbook remains canonical.
- Generated skills stay thin trigger wrappers.
- Skill descriptions get the shortest useful signal because discovery is the load-bearing phase.
- The fuller guidance appears only where longer text is appropriate.
- Commands and Cursor rules are not part of this signal: Claude commands are user-invoked slash shims, and Cursor rules are path-triggered.
- Existing project-owned playbooks, maintenance docs, and pointer docs are not modified in Tier 1.
- Generic helper skills remain usable, but they should align with the project playbook rather than override it.

## Guidance Model

Create `scripts/lib/playbook-first-guidance.mjs` as the single source for the signal and guidance text.

```js
export const PLAYBOOK_FIRST_GUIDANCE = {
  version: 1,
  heading: 'Playbook-First Guidance',
  signal: 'Project playbook is source of truth.',
  guidance:
    'For tasks covered by this project trigger layer, the project playbook is the source of truth; generic helper guidance should align with it, not override it.',
};
```

The module also exports idempotent helpers:

- `appendPlaybookFirstSignal(description)`
- `hasPlaybookFirstSignal(description)`
- `hasPlaybookFirstGuidance(text)`

The signal is appended only when absent. This prevents duplicate wording when `import-claude-skills` is rerun or a provided task description already includes the signal.

## Implementation Interface

Thread the feature through `writeTriggerLayer()` with an explicit option:

```js
writeTriggerLayer({
  // existing options...
  playbookFirstGuidance: true,
});
```

Rules:

- `writeTriggerLayer()` defaults `playbookFirstGuidance` to `false` unless a caller passes it.
- `init-project-trigger-layer.mjs` always passes `playbookFirstGuidance: true`, including when `--force` regenerates an older unflagged plugin.
- `init --force` is the explicit migration path for older unflagged plugins. Existing checksum protection still prevents overwriting locally edited generated wrappers.
- `import-claude-skills` computes the option from the target plugin state as described in the Import Behavior section.

The option flows through `writeTriggerLayer()` -> `createWriteContext()` -> `writeTaskWrappers()` and `writeGeneratedManifest()`.

## Generated Surfaces

Required generated surfaces when a plugin opts into playbook-first guidance:

- Each generated skill frontmatter `description` includes `PLAYBOOK_FIRST_GUIDANCE.signal`.
- Each generated skill body checklist includes `PLAYBOOK_FIRST_GUIDANCE.guidance`.

This requires changing `templates/project-trigger-layer/skill/SKILL.md.template` to include a placeholder such as `{{playbookFirstGuidance}}` in the checklist. All render paths must provide the placeholder value because `renderTemplate()` throws on unresolved template placeholders. When `playbookFirstGuidance` is disabled, the placeholder should render to an empty string or be omitted without leaving blank checklist noise.

Best-effort surfaces for new files only:

- A newly created playbook placeholder includes `## Playbook-First Guidance` with the full guidance. This applies to both `init`'s `writePlaybookPlaceholderFile()` path and the `import-claude-skills` `playbookHeader()` path when the import creates a new playbook for a guided plugin.
- A newly created `.agent-trigger-kit/MAINTENANCE.md` includes a reminder not to treat third-party plugins or global config edits as the default fix for trigger collisions.

Not included in Tier 1:

- No `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` creation or upsert.
- No command template changes for the guidance signal.
- No Cursor rule template changes for the guidance signal.
- No validator requirement for playbook or maintenance guidance.

## Init Behavior

`init-project-trigger-layer.mjs` enables playbook-first guidance for the generated plugin.

It also accepts a new optional argument:

```bash
--task-descriptions '{"docs-review":"Use for docs, playbooks, todo, done-log, review-log, and docs-only closeout."}'
```

Rules:

- The value must be valid JSON object text.
- Each key must match one task listed in `--tasks`.
- Each value must be a non-empty single-line string. Newlines are rejected because generated skill frontmatter descriptions are parsed as single-line values.
- Tasks without an explicit description keep using `taskDescriptionFor(task)`.
- Every final description gets the idempotent signal append.
- The top-level `scripts/cli.mjs` dispatcher does not need special handling for this option because it forwards all command arguments to `init-project-trigger-layer.mjs`; tests should still cover the CLI path.

This addresses the discovery root cause directly: generated init descriptions can carry useful task-specific trigger words instead of only the generic fallback phrase.

## Import Behavior

`import-claude-skills` keeps preserving each source skill description, then appends the short signal idempotently when the target plugin is using playbook-first guidance.

Flag behavior is intentionally conservative:

- Brand-new imported plugin: set `playbookFirstGuidance: { "version": 1 }`, because all generated wrappers are emitted with the new shape.
- Existing flagged plugin: preserve the flag and emit imported task wrappers with the signal and checklist guidance.
- Existing unflagged plugin: do not set the flag and do not upgrade old wrappers. The import only adds the selected task wrappers.

Upgrading an old unflagged plugin should be an explicit migration path, not a side effect of importing one task. Running `init --force` for that plugin is the explicit migration path because it regenerates the full wrapper set and then sets the flag.

## Generated Manifest

Use a per-plugin gate, not global `templateVersion`.

```json
{
  "schemaVersion": 2,
  "plugins": {
    "demo-ops": {
      "pluginVersion": "0.1.0",
      "playbookFirstGuidance": { "version": 1 },
      "playbook": "docs/agent-playbooks/demo-ops.md",
      "maintenanceContract": ".agent-trigger-kit/MAINTENANCE.md",
      "tasks": ["docs-review"],
      "files": []
    }
  }
}
```

The per-plugin flag prevents multi-plugin repos from failing validation when only one plugin has been regenerated with the new guidance.

This flag must survive manifest normalization and upsert. Update `scripts/lib/generated-manifest.mjs` so `copyPluginEntry()` preserves `playbookFirstGuidance`, and update the entry object passed from `writeGeneratedManifest()` so it includes `playbookFirstGuidance` only when the option is enabled. Without this change, `upsertGeneratedPluginEntry()` and `normalizeGeneratedManifest()` silently drop the flag and validator gating never runs.

## Validator

`validate-trigger-layer.mjs` imports `PLAYBOOK_FIRST_GUIDANCE` and checks only plugins whose generated manifest entry contains `playbookFirstGuidance.version === 1`.

Required checks for flagged plugins:

- Every generated `kind: "skill"` file has frontmatter `description` containing the signal.
- Every generated `kind: "skill"` file body contains the full guidance.

Non-required checks:

- Playbook guidance section is not required.
- Maintenance guidance line is not required.
- Commands and Cursor rules are not checked for this feature.
- Old generated manifests without the flag pass.

Known limitation: current generated manifest upserts replace the plugin entry's `tasks` and `files` with the files emitted during that run. Repeated incremental `import-claude-skills` runs can leave older wrappers on disk but absent from the manifest. The Tier 1 validator follows the manifest-owned generated files, matching existing maintenance-pointer validation. A future hardening pass can scan `plugins/<plugin>/skills/*/SKILL.md` directly if the project decides to make validation cover all on-disk wrappers.

Validator error messages should be explicit:

- Name the plugin and wrapper path.
- State whether the missing piece is the description signal or checklist guidance.
- Explain that the generated wrapper has drifted from the flagged guidance shape.
- Suggest restoring the managed wrapper, manually adding the missing signal/guidance, or explicitly removing the plugin flag to opt out.

The message should not imply that `init --force` is always enough, because checksum protection can reject regeneration when the wrapper already has local edits.

## Documentation And Release

Implementation scope includes docs and versioning:

- Update `README.md` to document playbook-first guidance, `--task-descriptions`, and the command/Cursor non-scope.
- Update `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md` so agents learn the model.
- Update `CHANGELOG.md` with version `0.1.8`.
- Bump aligned plugin versions from `0.1.7` to `0.1.8` in `package.json`, Codex marketplace, Codex plugin manifest, Claude marketplace, and Claude plugin manifest.

## Tests

Add tests for:

- `init` emits the per-plugin manifest flag.
- `init` emits skill description signal and checklist guidance.
- `init --task-descriptions` uses task-specific JSON descriptions.
- `init --task-descriptions` rejects unknown task keys and invalid/non-string values.
- `init --task-descriptions` rejects values containing newlines.
- `agent-trigger-kit init --task-descriptions ...` forwards the option through `scripts/cli.mjs`.
- Signal append is idempotent.
- Brand-new `import-claude-skills` preserves imported descriptions and appends the signal.
- Existing unflagged plugin import does not set the playbook-first flag.
- Existing flagged plugin import keeps the flag and emits guided wrappers for new tasks.
- Manifest round-trip through `upsertGeneratedPluginEntry()` and `normalizeGeneratedManifest()` preserves `playbookFirstGuidance`.
- Validator passes old generated manifests without the flag.
- Validator fails flagged plugins missing the description signal.
- Validator fails flagged plugins missing checklist guidance.
- Validator checks only flagged plugins in a multi-plugin repo.

## Deferred Work

Tier 2: pointer docs for `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`.

This needs a separate managed-region protocol, idempotent upsert behavior, conflict handling, and a tracking model that can represent region hashes rather than whole-file hashes.

Tier 3: task-specific guidance profiles.

Profiles such as docs-review or commit closeout can add concrete task precedence later, but the default Tier 1 guidance stays abstract and task-agnostic.
