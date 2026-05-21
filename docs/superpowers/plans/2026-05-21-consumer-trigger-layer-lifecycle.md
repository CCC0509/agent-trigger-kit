# Consumer Trigger Layer Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document and test the scope-first lifecycle for generated consumer trigger layers, separating pinned static validation from manual live discovery.

**Architecture:** Keep Agent Trigger Kit as the single source of trigger-layer lifecycle guidance. Add regression coverage for the documented lifecycle language, update README and the relevant plugin skills, then bump the aligned plugin version because plugin-visible skill files change.

**Tech Stack:** Markdown docs, Node.js ESM `node:test`, existing `bump-plugin-version.mjs`, existing `validate-trigger-layer.mjs`, no new runtime dependencies.

---

## File Structure

- Modify: `tests/trigger-layer-scripts.test.mjs`
  - Adds a docs/skill regression test that locks the scope-first lifecycle, pinned `KIT_SPEC`, static/manual gate split, Claude restart/timeout guidance, Codex cleanup guidance, Cursor static-only status, and Gemini out-of-scope status.
- Modify: `README.md`
  - Adds a concise consumer trigger-layer lifecycle section for operators and points the full manual live-discovery checklist to the cross-agent trigger-layer skill.
- Modify: `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md`
  - Becomes the canonical home for the manual live-discovery checklist and documents scope-first lifecycle, pinned kit-source validation, static gates, manual discovery, and failure branches.
- Modify: `plugins/agent-trigger-kit/skills/claude-plugin-lifecycle/SKILL.md`
  - Clarifies that `claude plugin list --json` is preferred install-state evidence, `claude plugin validate` can be bounded with a 20 second timeout when unreliable, and Claude Code must be restarted before deciding discovery failed.
- Modify: `plugins/agent-trigger-kit/skills/version-check/SKILL.md`
  - Reinforces read-only source/cache checks before any user-level config mutation and names `--surface source` as the static source-alignment check.
- Modify: `CHANGELOG.md`
  - Adds release notes for `0.1.10`.
- Modify via script: `package.json`
  - Bumps `0.1.9` to `0.1.10`.
- Modify via script: `.agents/plugins/marketplace.json`
  - Bumps the Codex marketplace entry to `0.1.10`.
- Modify via script: `plugins/agent-trigger-kit/.codex-plugin/plugin.json`
  - Bumps the Codex plugin manifest to `0.1.10`.
- Modify via script: `.claude-plugin/marketplace.json`
  - Bumps the Claude marketplace entry to `0.1.10`.
- Modify via script: `plugins/agent-trigger-kit/.claude-plugin/plugin.json`
  - Bumps the Claude plugin manifest to `0.1.10`.

## Execution Setup

Run this work on a feature branch. If the branch already exists, switch to it instead of creating a duplicate.

```bash
git switch -c feat/consumer-trigger-layer-lifecycle
```

The current untracked design spec and this plan should be included in the implementation commit unless the maintainer asks to keep planning docs separate.

---

### Task 1: Add Lifecycle Documentation Regression Test

**Files:**

- Modify: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Add the failing docs/skill test**

Add this test after the existing `version and lifecycle skills document provenance-aware Claude fallback` test:

```js
test('consumer trigger lifecycle guidance documents pinned static gates and manual discovery', () => {
  const readRepoFile = (path) => readFileSync(join(repoRoot, path), 'utf8');
  const readme = readRepoFile('README.md');
  const crossSkill = readRepoFile(
    'plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md',
  );
  const lifecycleSkill = readRepoFile(
    'plugins/agent-trigger-kit/skills/claude-plugin-lifecycle/SKILL.md',
  );
  const versionSkill = readRepoFile('plugins/agent-trigger-kit/skills/version-check/SKILL.md');

  assert.match(
    readme,
    /Consumer Trigger Layer Lifecycle[\s\S]*KIT_SPEC=github:CCC0509\/agent-trigger-kit#<tag-or-commit>/,
  );
  assert.match(readme, /Consumer Trigger Layer Lifecycle[\s\S]*--surface source/);
  assert.match(
    readme,
    /Consumer Trigger Layer Lifecycle[\s\S]*agent-trigger-kit:cross-agent-trigger-layer/,
  );

  assert.match(crossSkill, /## Scope First/);
  assert.match(crossSkill, /target repo path/i);
  assert.match(crossSkill, /Agent Trigger Kit source or installed version/);
  assert.match(crossSkill, /unqualified `github:CCC0509\/agent-trigger-kit`/);
  assert.match(crossSkill, /## Static Gate/);
  assert.match(crossSkill, /KIT_SPEC=github:CCC0509\/agent-trigger-kit#<tag-or-commit>/);
  assert.match(crossSkill, /version-check[\s\S]*--surface source/);
  assert.match(crossSkill, /## Manual Live Discovery/);
  assert.match(crossSkill, /codex debug prompt-input "test"/);
  assert.match(crossSkill, /claude plugin list --json/);
  assert.match(crossSkill, /Cursor support is static/);
  assert.match(crossSkill, /Gemini is out of scope/);
  assert.match(crossSkill, /## Failure Branches/);

  assert.match(lifecycleSkill, /preferred install-state evidence/);
  assert.match(lifecycleSkill, /20 second/);
  assert.match(lifecycleSkill, /inconclusive/);
  assert.match(lifecycleSkill, /Restart Claude Code/);

  assert.match(versionSkill, /For generated consumer trigger layers[\s\S]*--surface source/);
  assert.match(versionSkill, /temporary Codex project[\s\S]*global config mutation/);
  assert.match(versionSkill, /global config cleanup was verified/);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'consumer trigger lifecycle guidance'
```

Expected: FAIL because the README and skills do not yet contain the new lifecycle wording.

---

### Task 2: Document The Consumer Lifecycle In README

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Add the README lifecycle section**

In `README.md`, add this section immediately after the existing "Validate a project trigger layer" command block under "Use In A Project" and before "Load the generated project plugin for Claude Code only when the project wants...":

````markdown
### Consumer Trigger Layer Lifecycle

Before updating an existing generated project trigger layer, write down the
target repo path, current working directory, plugin name, canonical playbook
path, generated manifest path, agent surfaces in scope, and Agent Trigger Kit
source or installed version used for generation. If those values cannot be
named, stop before writing files or running install/update commands.

Use the same pinned Agent Trigger Kit source for generation and static
validation. Do not let CI float on the GitHub default branch:

```bash
KIT_SPEC=github:CCC0509/agent-trigger-kit#<tag-or-commit>
npx --yes "$KIT_SPEC" validate --root <target-repo>
npx --yes "$KIT_SPEC" version-check \
  --root <target-repo> \
  --surface source \
  <plugin-name>
npx --yes "$KIT_SPEC" validate \
  --root <target-repo> \
  --require-version-bump \
  --base main
```

Use `--require-version-bump` when the branch changes generated skills, generated
commands, plugin manifests, or marketplace entries for the plugin. Wrapper typo
fixes are still plugin-visible changes and still need the aligned plugin version
bump.

Live discovery is a manual release checklist, not a CI gate. The canonical
checklist lives in `agent-trigger-kit:cross-agent-trigger-layer`; README and
consumer project docs should point there instead of duplicating it.
````

- [ ] **Step 2: Run the focused docs test and confirm README assertions now pass or fail later**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'consumer trigger lifecycle guidance'
```

Expected: still FAIL until the three plugin skills are updated. The README-related assertions should no longer be the failing assertions.

---

### Task 3: Make Cross-Agent Trigger Layer Skill The Canonical Checklist Home

**Files:**

- Modify: `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md`

- [ ] **Step 1: Add the scope-first section**

In `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md`, add this section immediately before `## Build Order`:

```markdown
## Scope First

Before changing a generated consumer trigger layer, name the target repo path,
current working directory, plugin name, canonical playbook path, generated
manifest path, agent surfaces in scope, and Agent Trigger Kit source or
installed version used for generation.

If those values cannot be named, stop before writing files or running
install/update commands. This is operator discipline; the validator cannot infer
whether the agent is working in the intended repo.

Use the same pinned Agent Trigger Kit source for generation and validation. For
`npx`, pin the GitHub package spec to a tag or commit SHA. Do not use an
unqualified `github:CCC0509/agent-trigger-kit` package spec in CI.
```

- [ ] **Step 2: Replace the required checks section**

Replace the existing `## Required Checks` section with this content:

````markdown
## Static Gate

The static gate is CI-safe and does not depend on user-level agent state. For a
consumer repo, prefer the packaged CLI entrypoint because it runs the same
canonical validator as `scripts/validate-trigger-layer.mjs`:

```bash
KIT_SPEC=github:CCC0509/agent-trigger-kit#<tag-or-commit>
npx --yes "$KIT_SPEC" validate --root <target-repo>
npx --yes "$KIT_SPEC" version-check \
  --root <target-repo> \
  --surface source \
  <plugin-name>
npx --yes "$KIT_SPEC" validate \
  --root <target-repo> \
  --require-version-bump \
  --base main
```

Use `version-check --surface source` when the workflow needs full source version
alignment but the branch does not have a plugin-visible diff that triggers
`--require-version-bump`.

Plugin-visible changes include generated skills, generated commands, plugin
manifests, and marketplace entries for the plugin. Wrapper typo fixes are still
plugin-visible changes and need an aligned version bump.

## Manual Live Discovery

Live discovery is a manual release checklist, not a CI gate. Run it only after
the static gate passes, required version bumps are applied, relevant plugins are
installed or updated, and Claude Code has been restarted after install/update.

Codex:

```bash
codex debug prompt-input "test"
```

Confirm the expected `<plugin-name>:<skill-name>` entries. If a generated
project plugin was temporarily added to Codex global config for discovery,
remove it afterwards and confirm `~/.codex/config.toml` no longer contains the
project plugin.

Claude Code:

```bash
claude plugin list --json
```

For generated project plugins, confirm `"scope": "project"` and the expected
`projectPath`. Treat `claude plugin validate <path>` hangs as inconclusive; use
a 20 second timeout wrapper when needed to keep the session from blocking. Do
not make a hanging validate command the only discovery signal.

Cursor:

Cursor support is static in this toolkit. Verify `.cursor/rules/*.mdc`
frontmatter, globs, and canonical references. Do not describe Cursor as having a
headless runtime discovery gate unless a real probe is added later.

Gemini:

Gemini is out of scope unless the kit adds Gemini templates and validator rules.
Pointer link checks for existing `GEMINI.md` files are not generated Gemini
trigger-layer support.

## Failure Branches

If static validation fails, block the PR and repair the generated layer or
canonical refs before live discovery.

If a consuming project has a stale local validator, replace the workflow with
the current kit validator or regenerate the trigger layer. Do not patch the
stale validator by hand unless the project intentionally owns a fork.

If Codex discovery fails, check whether the marketplace root was added instead
of the plugin subdirectory, whether the installed cache is stale, and whether
global config cleanup left the plugin disabled or absent.

If Claude discovery fails, check install scope, `projectPath`, cache version,
declared `commands`, stale snapshots, `.orphaned_at`, and whether Claude Code was
restarted after update.

If a live discovery step mutates user-level config and the session is
interrupted, cleanup is required before reporting completion. The final report
must say whether cleanup was verified.
````

- [ ] **Step 3: Update common mistakes**

In the `## Common Mistakes` list, add these bullets near the existing scope and Codex bullets:

```markdown
- Validating consumer trigger layers with a floating `github:CCC0509/agent-trigger-kit`
  package spec instead of the pinned kit source named during scope setup.
- Treating live discovery as a CI gate; Codex and Claude can be probed manually,
  while Cursor is static-only in this toolkit.
- Forgetting that Claude Code must restart after plugin install or update before
  skill and slash-command discovery results are meaningful.
```

- [ ] **Step 4: Run the focused docs test and confirm cross-skill assertions now pass or fail later**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'consumer trigger lifecycle guidance'
```

Expected: still FAIL until `claude-plugin-lifecycle` and `version-check` are updated. README and cross-agent skill assertions should no longer be the failing assertions.

---

### Task 4: Clarify Claude Discovery And Restart Boundaries

**Files:**

- Modify: `plugins/agent-trigger-kit/skills/claude-plugin-lifecycle/SKILL.md`

- [ ] **Step 1: Replace the diagnose section**

Replace the current `## Diagnose` section with this content:

````markdown
## Diagnose

1. Confirm install state with the preferred install-state evidence:

   ```bash
   claude plugin list --json
   ```

   For generated project plugins, confirm `"scope": "project"` and the expected
   `projectPath`.

2. Confirm the marketplace and plugin manifests when the validate command is
   reliable in the current environment:

   ```bash
   claude plugin validate <repo-root>
   claude plugin validate <repo-root>/plugins/<plugin-name>
   ```

   If `claude plugin validate <path>` hangs, treat the result as inconclusive
   and use a 20 second timeout wrapper only to keep the session from blocking.
   Do not make the hanging validate command the only discovery signal.

3. Inspect the cache path from `plugin list --json`.
   - `skills/` present but no slash menu: expected unless `commands/` exists and is declared.
   - source has `commands/` but cache does not: stale snapshot or version issue.
   - `.orphaned_at` exists: install/cache state needs cleanup or reinstall.

4. Restart Claude Code after install or update before deciding that skills or
   slash commands are missing.
````

- [ ] **Step 2: Run the focused docs test and confirm Claude assertions now pass or fail later**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'consumer trigger lifecycle guidance'
```

Expected: still FAIL until `version-check` is updated. README, cross-agent skill, and Claude lifecycle assertions should no longer be the failing assertions.

---

### Task 5: Reinforce Read-Only Version Checks Before Global Config Mutation

**Files:**

- Modify: `plugins/agent-trigger-kit/skills/version-check/SKILL.md`

- [ ] **Step 1: Add consumer source-alignment guidance to the core model**

In `## Core Model`, add these bullets after the existing "Version checks are read-only by default..." bullet:

```markdown
- For generated consumer trigger layers, `--surface source` is the static source
  alignment check for package, marketplace, and plugin manifest versions.
- Run read-only source/cache checks before any temporary Codex project
  marketplace registration or other user-level global config mutation.
```

- [ ] **Step 2: Add the source-alignment command to the checklist**

In `## Checklist`, add this paragraph after the first command block:

````markdown
For generated consumer trigger layers, use the pinned kit source named during
scope setup and run source alignment before live discovery:

```bash
npx --yes "$KIT_SPEC" version-check \
  --root <target-repo> \
  --surface source \
  <plugin-name>
```
````

- [ ] **Step 3: Add Codex cleanup wording**

In `## Reporting`, add this bullet:

```markdown
- If a live Codex discovery step mutates global config, report whether the
  temporary generated project marketplace was removed and whether global config
  cleanup was verified.
```

- [ ] **Step 4: Run the focused docs test and confirm it passes**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'consumer trigger lifecycle guidance'
```

Expected: PASS.

---

### Task 6: Update Release Metadata For Plugin-Visible Skill Changes

**Files:**

- Modify: `CHANGELOG.md`
- Modify via script: `package.json`
- Modify via script: `.agents/plugins/marketplace.json`
- Modify via script: `plugins/agent-trigger-kit/.codex-plugin/plugin.json`
- Modify via script: `.claude-plugin/marketplace.json`
- Modify via script: `plugins/agent-trigger-kit/.claude-plugin/plugin.json`

- [ ] **Step 1: Add the changelog entry**

Add this release entry immediately above `## 0.1.9` in `CHANGELOG.md`:

```markdown
## 0.1.10

- Documented the consumer trigger-layer lifecycle with scope-first setup,
  pinned static validation, and manual live-discovery boundaries.
- Made `agent-trigger-kit:cross-agent-trigger-layer` the canonical home for the
  generated project plugin live-discovery checklist.
- Clarified Claude Code restart and `claude plugin validate` timeout guidance
  for generated project plugin troubleshooting.
```

- [ ] **Step 2: Bump aligned plugin versions**

Run:

```bash
node scripts/bump-plugin-version.mjs --root . --plugin agent-trigger-kit --next patch
```

Expected output includes updates to:

```text
updated package.json
updated .agents/plugins/marketplace.json
updated plugins/agent-trigger-kit/.codex-plugin/plugin.json
updated .claude-plugin/marketplace.json
updated plugins/agent-trigger-kit/.claude-plugin/plugin.json
```

- [ ] **Step 3: Verify source versions are aligned**

Run:

```bash
npm run ops:plugin-version-check -- --surface source agent-trigger-kit
```

Expected: PASS and output reports expected source version `0.1.10`.

- [ ] **Step 4: Run the focused docs tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'consumer trigger lifecycle guidance|version and lifecycle skills document provenance-aware Claude fallback|agent-trigger-kit exposes version-check skill'
```

Expected: PASS.

- [ ] **Step 5: Commit the lifecycle documentation and version bump**

Run:

```bash
git add README.md CHANGELOG.md package.json .agents/plugins/marketplace.json .claude-plugin/marketplace.json plugins/agent-trigger-kit/.codex-plugin/plugin.json plugins/agent-trigger-kit/.claude-plugin/plugin.json plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md plugins/agent-trigger-kit/skills/claude-plugin-lifecycle/SKILL.md plugins/agent-trigger-kit/skills/version-check/SKILL.md tests/trigger-layer-scripts.test.mjs docs/superpowers/specs/2026-05-21-consumer-trigger-layer-lifecycle-design.md docs/superpowers/plans/2026-05-21-consumer-trigger-layer-lifecycle.md
git commit -m "docs: harden consumer trigger layer lifecycle"
```

Expected: commit succeeds.

---

### Task 7: Final Verification

**Files:**

- No new file changes expected unless verification exposes a defect.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run trigger-layer validation**

Run:

```bash
npm run validate
```

Expected: PASS with `trigger layer validation passed for .`.

- [ ] **Step 3: Run formatting and lint checks**

Run:

```bash
npm run format:check
npm run lint
```

Expected: both commands PASS.

- [ ] **Step 4: Run source version check**

Run:

```bash
npm run ops:plugin-version-check -- --surface source agent-trigger-kit
```

Expected: PASS and source version `0.1.10`.

- [ ] **Step 5: Run the plugin-visible version-bump gate**

Run:

```bash
node scripts/validate-trigger-layer.mjs --root . --require-version-bump --base main
```

Expected: PASS. If the branch base in this checkout is not `main`, rerun with the actual review base before reporting completion.

- [ ] **Step 6: Inspect the final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: no unexpected files. The implementation commit contains lifecycle docs, skill updates, focused tests, changelog, aligned version bumps, and the design/plan docs.

---

## Self-Review Notes

- Spec coverage: Tasks 2-5 cover scope-first lifecycle, pinned static gate, manual live discovery, Claude restart/timeout, Codex cleanup, Cursor static-only, Gemini out-of-scope, and read-only version checks. Task 6 covers mechanical version bump. Task 7 covers final verification.
- Existing validator behavior coverage: the non-optional validator tests listed
  in the design spec are already covered by `validator fails when a command
delegates to a missing skill`, `validator fails when Claude commands exist but
are not declared`, `validator require-version-bump rejects managed skill
changes without a version bump`, and `validator require-version-bump accepts
managed skill changes with aligned version bump` in
  `tests/trigger-layer-scripts.test.mjs`. This plan does not duplicate those
  fixtures.
- Validator hardening: The spec's strict YAML parsing item is intentionally not implemented in this plan because it is conditional and this repo currently has no YAML parser dependency. The plan tightens existing validator-backed lifecycle behavior through docs tests instead.
- Drift avoidance: The plan pins `KIT_SPEC` in docs and tests and makes `cross-agent-trigger-layer` the canonical manual checklist home so consumer docs can remain thin pointers.
