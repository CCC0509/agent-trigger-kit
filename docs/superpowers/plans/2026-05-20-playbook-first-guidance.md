# Playbook-First Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add playbook-first guidance to generated project trigger-layer skills and let `init` accept richer task descriptions without modifying pointer docs or user-owned existing playbooks.

**Architecture:** Add a small guidance module that owns the signal and full guidance text, then thread an explicit `playbookFirstGuidance` option through the shared trigger-layer generator. Persist the per-plugin manifest flag, validate only flagged generated skills, and keep import behavior conservative for existing unflagged plugins. Add `--task-descriptions` to `init` so task-specific trigger words handle the discovery problem while the guidance signal acts as a precedence hint.

**Tech Stack:** Node.js ESM scripts, `node:test`, existing JSON/file helpers, Markdown templates, no new runtime dependencies.

---

## File Structure

- Create: `scripts/lib/playbook-first-guidance.mjs`
  - Owns `PLAYBOOK_FIRST_GUIDANCE` and idempotent helper functions.
- Modify: `scripts/lib/generated-manifest.mjs`
  - Preserve `playbookFirstGuidance` through manifest normalization and upsert.
- Modify: `scripts/lib/trigger-layer.mjs`
  - Accept `playbookFirstGuidance`, append description signals, render skill checklist guidance, write new-file playbook and maintenance guidance, and persist the manifest flag.
- Modify: `templates/project-trigger-layer/skill/SKILL.md.template`
  - Add a checklist placeholder for playbook-first guidance.
- Modify: `scripts/init-project-trigger-layer.mjs`
  - Parse and validate `--task-descriptions`; always enable playbook-first guidance for `init`.
- Modify: `scripts/import-claude-skills.mjs`
  - Read target plugin generated state, enable guidance for brand-new or already-flagged plugins, and add guidance to newly created import playbooks when enabled.
- Modify: `scripts/validate-trigger-layer.mjs`
  - Add flag-gated generated skill checks for description signal and checklist guidance.
- Modify: `tests/trigger-layer-scripts.test.mjs`
  - Add unit and integration tests for guidance helpers, manifest round-trip, init, import, and validator behavior.
- Modify: `README.md`
  - Document playbook-first guidance, `--task-descriptions`, and command/Cursor non-scope.
- Modify: `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md`
  - Teach agents the playbook-first guidance model.
- Modify: `CHANGELOG.md`
  - Add `0.1.8` release notes and, if needed, note any missing `0.1.7` history discovered during implementation.
- Modify: `package.json`
  - Bump from `0.1.7` to `0.1.8`.
- Modify: `.agents/plugins/marketplace.json`
  - Bump the Agent Trigger Kit Codex marketplace entry from `0.1.7` to `0.1.8`.
- Modify: `plugins/agent-trigger-kit/.codex-plugin/plugin.json`
  - Bump the Codex plugin manifest from `0.1.7` to `0.1.8`.
- Modify: `.claude-plugin/marketplace.json`
  - Bump the Agent Trigger Kit Claude marketplace entry from `0.1.7` to `0.1.8`.
- Modify: `plugins/agent-trigger-kit/.claude-plugin/plugin.json`
  - Bump the Claude plugin manifest from `0.1.7` to `0.1.8`.

---

### Task 1: Add Guidance Helpers And Manifest Persistence

**Files:**
- Create: `scripts/lib/playbook-first-guidance.mjs`
- Modify: `scripts/lib/generated-manifest.mjs`
- Test: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Write failing helper and manifest tests**

Append these tests near the existing generated manifest/helper tests in `tests/trigger-layer-scripts.test.mjs`:

```js
test('playbook-first guidance helpers append signal idempotently', async () => {
  const {
    PLAYBOOK_FIRST_GUIDANCE,
    appendPlaybookFirstSignal,
    hasPlaybookFirstGuidance,
    hasPlaybookFirstSignal,
  } = await import('../scripts/lib/playbook-first-guidance.mjs');

  assert.equal(
    appendPlaybookFirstSignal('Use for docs review work.'),
    'Use for docs review work. Project playbook is source of truth.',
  );
  assert.equal(
    appendPlaybookFirstSignal(
      'Use for docs review work. Project playbook is source of truth.',
    ),
    'Use for docs review work. Project playbook is source of truth.',
  );
  assert.equal(hasPlaybookFirstSignal('Project playbook is source of truth.'), true);
  assert.equal(hasPlaybookFirstGuidance(PLAYBOOK_FIRST_GUIDANCE.guidance), true);
});

test('generated manifest round-trips playbook-first guidance flag', () => {
  const manifest = {
    schemaVersion: 2,
    kitVersion: '0.1.7',
    templateVersion: 1,
    plugins: {
      'demo-ops': {
        pluginVersion: '0.1.0',
        playbookFirstGuidance: { version: 1 },
        playbook: 'docs/agent-playbooks/demo-ops.md',
        maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
        tasks: ['docs-review'],
        files: [],
      },
    },
  };

  const normalized = normalizeGeneratedManifest(manifest);
  assert.deepEqual(normalized.plugins['demo-ops'].playbookFirstGuidance, { version: 1 });

  const updated = upsertGeneratedPluginEntry(
    manifest,
    'demo-ops',
    {
      pluginVersion: '0.1.1',
      playbookFirstGuidance: { version: 1 },
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review', 'deploy-ops'],
      files: [],
    },
    { kitVersion: '0.1.8', templateVersion: 1 },
  );

  assert.deepEqual(updated.plugins['demo-ops'].playbookFirstGuidance, { version: 1 });
});
```

Add this import near the existing helper imports; `tests/trigger-layer-scripts.test.mjs` does not currently import `scripts/lib/generated-manifest.mjs`:

```js
import {
  normalizeGeneratedManifest,
  upsertGeneratedPluginEntry,
} from '../scripts/lib/generated-manifest.mjs';
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'playbook-first guidance|round-trips playbook-first'
```

Expected: FAIL because `scripts/lib/playbook-first-guidance.mjs` does not exist and `copyPluginEntry()` drops `playbookFirstGuidance`.

- [ ] **Step 3: Create the guidance module**

Create `scripts/lib/playbook-first-guidance.mjs`:

```js
export const PLAYBOOK_FIRST_GUIDANCE = {
  version: 1,
  heading: 'Playbook-First Guidance',
  signal: 'Project playbook is source of truth.',
  guidance:
    'For tasks covered by this project trigger layer, the project playbook is the source of truth; generic helper guidance should align with it, not override it.',
};

export function hasPlaybookFirstSignal(text) {
  return String(text ?? '').includes(PLAYBOOK_FIRST_GUIDANCE.signal);
}

export function hasPlaybookFirstGuidance(text) {
  return String(text ?? '').includes(PLAYBOOK_FIRST_GUIDANCE.guidance);
}

export function appendPlaybookFirstSignal(description) {
  const text = String(description ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return PLAYBOOK_FIRST_GUIDANCE.signal;
  if (hasPlaybookFirstSignal(text)) return text;
  return `${text} ${PLAYBOOK_FIRST_GUIDANCE.signal}`;
}
```

- [ ] **Step 4: Preserve the manifest flag**

Modify `scripts/lib/generated-manifest.mjs` so `copyPluginEntry()` preserves the flag:

```js
function copyPlaybookFirstGuidance(value) {
  if (!value || typeof value !== 'object') return undefined;
  return { version: value.version };
}

function copyPluginEntry(entry = {}) {
  return {
    pluginVersion: entry.pluginVersion,
    playbook: entry.playbook,
    maintenanceContract: entry.maintenanceContract,
    playbookFirstGuidance: copyPlaybookFirstGuidance(entry.playbookFirstGuidance),
    tasks: copyTasks(entry.tasks),
    files: copyFiles(entry.files),
  };
}
```

If tests or lint complain about explicit `undefined` fields in JSON snapshots, adjust by spreading only when present:

```js
function copyPluginEntry(entry = {}) {
  const playbookFirstGuidance = copyPlaybookFirstGuidance(entry.playbookFirstGuidance);
  return {
    pluginVersion: entry.pluginVersion,
    playbook: entry.playbook,
    maintenanceContract: entry.maintenanceContract,
    ...(playbookFirstGuidance ? { playbookFirstGuidance } : {}),
    tasks: copyTasks(entry.tasks),
    files: copyFiles(entry.files),
  };
}
```

- [ ] **Step 5: Run the focused tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'playbook-first guidance|round-trips playbook-first'
```

Expected: PASS.

- [ ] **Step 6: Commit this task**

Run:

```bash
git add scripts/lib/playbook-first-guidance.mjs scripts/lib/generated-manifest.mjs tests/trigger-layer-scripts.test.mjs
git commit -m "feat: add playbook-first guidance manifest support"
```

Expected: commit succeeds.

---

### Task 2: Thread Guidance Through The Generator And Skill Template

**Files:**
- Modify: `scripts/lib/trigger-layer.mjs`
- Modify: `templates/project-trigger-layer/skill/SKILL.md.template`
- Test: `tests/trigger-layer-scripts.test.mjs`

This task depends on Task 1 preserving `playbookFirstGuidance` in `copyPluginEntry()`. Several existing init tests compare generated manifest entries; without the Task 1 manifest fix, the new flag would be dropped or comparisons would drift.

- [ ] **Step 1: Write failing init output tests**

Add this test near the existing `init` tests:

```js
test('init emits playbook-first guidance flag and generated skill guidance', () => {
  const root = makeRoot();
  const result = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const entry = generatedPluginEntry(root);
  assert.deepEqual(entry.playbookFirstGuidance, { version: 1 });

  const skill = readFileSync(
    join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md'),
    'utf8',
  );
  assert.match(skill, /description: Use for docs review work in this repo\. Project playbook is source of truth\./);
  assert.match(
    skill,
    /For tasks covered by this project trigger layer, the project playbook is the source of truth; generic helper guidance should align with it, not override it\./,
  );

  const playbook = readFileSync(join(root, 'docs/agent-playbooks/demo-ops.md'), 'utf8');
  assert.match(playbook, /## Playbook-First Guidance/);

  const maintenance = readFileSync(join(root, '.agent-trigger-kit/MAINTENANCE.md'), 'utf8');
  assert.match(maintenance, /third-party plugin or global config/i);
});
```

- [ ] **Step 2: Run the focused test to confirm it fails**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'init emits playbook-first'
```

Expected: FAIL because `init` does not yet enable or render playbook-first guidance.

- [ ] **Step 3: Update the skill template**

Modify `templates/project-trigger-layer/skill/SKILL.md.template` checklist:

```markdown
## Checklist

{{playbookFirstGuidanceChecklistItem}}- State the matched playbook before acting.
- Maintenance contract: `{{maintenanceContract}}`
- Keep this wrapper short; do not copy long SOP bodies here.
- Run the project trigger-layer validator when editing trigger surfaces.
```

The placeholder value will include its own trailing newline when guidance is enabled. It will be an empty string when disabled, leaving no extra bullet.

- [ ] **Step 4: Import guidance helpers in the generator**

Add this import near the other imports in `scripts/lib/trigger-layer.mjs`:

```js
import {
  PLAYBOOK_FIRST_GUIDANCE,
  appendPlaybookFirstSignal,
} from './playbook-first-guidance.mjs';
```

- [ ] **Step 5: Add the context option**

Inside `createWriteContext(options)` in `scripts/lib/trigger-layer.mjs`, add:

```js
const playbookFirstGuidance = Boolean(options.playbookFirstGuidance);
```

Return it from the context object:

```js
playbookFirstGuidance,
```

- [ ] **Step 6: Render new-file playbook guidance**

Replace `writePlaybookPlaceholderFile()` content construction with a local `guidanceSection`:

```js
  function writePlaybookPlaceholderFile() {
    const taskList = tasks.map((task) => `- ${task}`).join('\n');
    const guidanceSection = playbookFirstGuidance
      ? `
## ${PLAYBOOK_FIRST_GUIDANCE.heading}

${PLAYBOOK_FIRST_GUIDANCE.guidance}
`
      : '';
    writeIfMissing(
      playbook,
      `# ${titleize(pluginName)} Playbook

This is the canonical playbook for the ${pluginName} trigger layer.
${guidanceSection}
## Tasks

${taskList}

Keep project operating rules here. Codex skills, Claude commands, Cursor rules, and pointer docs should stay thin references to this file.

Maintenance contract: \`${markdownRelativePath(dirname(playbook), DEFAULT_MAINTENANCE_CONTRACT)}\`
`,
    );
  }
```

- [ ] **Step 7: Render new-file maintenance guidance**

Inside `writeMaintenanceContract()`, add:

```js
    const guidanceLine = playbookFirstGuidance
      ? '- Treat third-party plugin or global config changes as explicit fixes, not the default response to trigger collisions.\n'
      : '';
```

Then include `${guidanceLine}` before the validator line:

```markdown
${guidanceLine}- Run the project trigger-layer validator after editing trigger surfaces.
```

- [ ] **Step 8: Append signal and checklist guidance to skill wrappers**

In `writeTaskWrappers()`, replace description calculation and add a template value:

```js
      const baseDescription = taskDescriptions.get(task) || taskDescriptionFor(task);
      const description = renderFrontmatterDescription(
        playbookFirstGuidance ? appendPlaybookFirstSignal(baseDescription) : baseDescription,
      );
      const values = {
        taskName: task,
        taskTitle: title,
        description,
        pluginName,
        playbookFirstGuidanceChecklistItem: playbookFirstGuidance
          ? `- ${PLAYBOOK_FIRST_GUIDANCE.guidance}\n`
          : '',
      };
```

This value must be passed to the skill template. It is harmless for command and Cursor templates because they do not reference it.

- [ ] **Step 9: Persist the manifest flag**

In `writeGeneratedManifest()`, add the flag to the entry object only when enabled:

```js
        {
          pluginVersion,
          ...(playbookFirstGuidance
            ? { playbookFirstGuidance: { version: PLAYBOOK_FIRST_GUIDANCE.version } }
            : {}),
          playbook,
          maintenanceContract: DEFAULT_MAINTENANCE_CONTRACT,
          tasks,
          files: generatedFiles,
        },
```

- [ ] **Step 10: Enable guidance in init**

In `scripts/init-project-trigger-layer.mjs`, pass:

```js
    playbookFirstGuidance: true,
```

inside the `writeTriggerLayer()` call.

- [ ] **Step 11: Run the focused test**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'init emits playbook-first'
```

Expected: PASS.

- [ ] **Step 12: Run existing template coverage**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'shared trigger layer generator consumes project trigger layer templates|cli routes init'
```

Expected: PASS.

- [ ] **Step 13: Commit this task**

Run:

```bash
git add scripts/lib/trigger-layer.mjs templates/project-trigger-layer/skill/SKILL.md.template scripts/init-project-trigger-layer.mjs tests/trigger-layer-scripts.test.mjs
git commit -m "feat: emit playbook-first guidance in trigger wrappers"
```

Expected: commit succeeds.

---

### Task 3: Add `--task-descriptions` To Init

**Files:**
- Modify: `scripts/init-project-trigger-layer.mjs`
- Test: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Write failing task description tests**

Add these tests near the existing init tests:

```js
test('init uses task-specific descriptions and appends playbook-first signal', () => {
  const root = makeRoot();
  const result = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review,deploy-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--task-descriptions',
    JSON.stringify({
      'docs-review':
        'Use for docs, playbooks, todo, done-log, review-log, and docs-only closeout.',
    }),
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const docsReview = readFileSync(
    join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md'),
    'utf8',
  );
  const deployOps = readFileSync(
    join(root, 'plugins/demo-ops/skills/deploy-ops/SKILL.md'),
    'utf8',
  );

  assert.match(
    docsReview,
    /description: "?Use for docs, playbooks, todo, done-log, review-log, and docs-only closeout\. Project playbook is source of truth\."?/,
  );
  assert.match(
    deployOps,
    /description: Use for deploy ops work in this repo\. Project playbook is source of truth\./,
  );
});

test('init rejects invalid task description maps', () => {
  const cases = [
    {
      name: 'unknown task',
      value: JSON.stringify({ missing: 'Use for missing work.' }),
      pattern: /unknown task description key missing/i,
    },
    {
      name: 'non-string value',
      value: JSON.stringify({ 'docs-review': 123 }),
      pattern: /docs-review.*non-empty single-line string/i,
    },
    {
      name: 'empty string',
      value: JSON.stringify({ 'docs-review': '   ' }),
      pattern: /docs-review.*non-empty single-line string/i,
    },
    {
      name: 'newline',
      value: JSON.stringify({ 'docs-review': 'Line one\nLine two' }),
      pattern: /docs-review.*single-line/i,
    },
    {
      name: 'invalid json',
      value: '{bad json',
      pattern: /--task-descriptions must be valid JSON/i,
    },
  ];

  for (const testCase of cases) {
    const root = makeRoot();
    const result = runScript('init-project-trigger-layer.mjs', [
      '--root',
      root,
      '--plugin',
      'demo-ops',
      '--tasks',
      'docs-review',
      '--playbook',
      'docs/agent-playbooks/demo-ops.md',
      '--task-descriptions',
      testCase.value,
    ]);

    assert.notEqual(result.status, 0, testCase.name);
    assert.match(result.stderr, testCase.pattern, testCase.name);
    assert.equal(existsSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md')), false);
  }
});

test('cli forwards init task descriptions', () => {
  const root = makeRoot();
  const result = runCli([
    'init',
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--task-descriptions',
    JSON.stringify({
      'docs-review': 'Use for docs and playbook review.',
    }),
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(
    readFileSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md'), 'utf8'),
    /description: Use for docs and playbook review\. Project playbook is source of truth\./,
  );
});
```

- [ ] **Step 2: Run the focused tests to confirm they fail**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'task descriptions|cli forwards init task descriptions'
```

Expected: FAIL because `init` does not parse `--task-descriptions` yet.

- [ ] **Step 3: Add parser helper in init**

In `scripts/init-project-trigger-layer.mjs`, add this helper above the `try` block:

```js
function parseTaskDescriptions(value, tasks) {
  const descriptions = new Map();
  if (value === undefined) return descriptions;
  if (typeof value !== 'string') {
    throw new Error('--task-descriptions must be valid JSON object text');
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`--task-descriptions must be valid JSON object text (${error.message})`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--task-descriptions must be a JSON object keyed by task name');
  }

  const taskSet = new Set(tasks);
  for (const [task, description] of Object.entries(parsed)) {
    if (!taskSet.has(task)) {
      throw new Error(`unknown task description key ${task}; expected one of ${tasks.join(', ')}`);
    }
    if (
      typeof description !== 'string' ||
      description.trim() === '' ||
      /[\r\n]/.test(description)
    ) {
      throw new Error(`${task} description must be a non-empty single-line string`);
    }
    descriptions.set(task, description.trim());
  }

  return descriptions;
}
```

- [ ] **Step 4: Pass task descriptions to the generator**

Before the `writeTriggerLayer()` call in `scripts/init-project-trigger-layer.mjs`, add:

```js
const taskDescriptions = parseTaskDescriptions(args['task-descriptions'], tasks);
```

Then include:

```js
    taskDescriptions,
```

inside the options passed to `writeTriggerLayer()`.

- [ ] **Step 5: Run the focused tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'task descriptions|cli forwards init task descriptions'
```

Expected: PASS.

- [ ] **Step 6: Commit this task**

Run:

```bash
git add scripts/init-project-trigger-layer.mjs tests/trigger-layer-scripts.test.mjs
git commit -m "feat: accept task-specific trigger descriptions"
```

Expected: commit succeeds.

---

### Task 4: Implement Conservative Import Guidance Behavior

**Files:**
- Modify: `scripts/import-claude-skills.mjs`
- Test: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Write failing import tests**

Add these tests near the existing importer tests:

```js
test('import-claude-skills creates brand-new guided plugin with preserved description signal', () => {
  const root = makeRoot();
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Read README changes.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(generatedPluginEntry(root).playbookFirstGuidance, { version: 1 });
  const wrapper = readFileSync(
    join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md'),
    'utf8',
  );
  assert.match(
    wrapper,
    /description: Review docs before release\. Project playbook is source of truth\./,
  );
  assert.match(wrapper, /For tasks covered by this project trigger layer/);
  assert.match(
    readFileSync(join(root, 'docs/agent-playbooks/demo-ops.md'), 'utf8'),
    /## Playbook-First Guidance/,
  );
});

test('import-claude-skills does not upgrade existing unflagged plugin', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [],
    },
  });
  write(
    root,
    '.claude/skills/deploy-ops/SKILL.md',
    `---
name: deploy-ops
description: Use when preparing deployments.
---

Deploy body.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(generatedPluginEntry(root).playbookFirstGuidance, undefined);
  assert.doesNotMatch(
    readFileSync(join(root, 'plugins/demo-ops/skills/deploy-ops/SKILL.md'), 'utf8'),
    /Project playbook is source of truth/,
  );
});

test('import-claude-skills preserves existing guided plugin flag for imported tasks', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbookFirstGuidance: { version: 1 },
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [],
    },
  });
  write(
    root,
    '.claude/skills/deploy-ops/SKILL.md',
    `---
name: deploy-ops
description: Use when preparing deployments.
---

Deploy body.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(generatedPluginEntry(root).playbookFirstGuidance, { version: 1 });
  assert.match(
    readFileSync(join(root, 'plugins/demo-ops/skills/deploy-ops/SKILL.md'), 'utf8'),
    /Use when preparing deployments\. Project playbook is source of truth\./,
  );
});
```

- [ ] **Step 2: Run focused import tests to confirm they fail**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'brand-new guided plugin|existing unflagged plugin|existing guided plugin flag'
```

Expected: FAIL because import does not yet read generated plugin state or pass `playbookFirstGuidance`.

- [ ] **Step 3: Import manifest helpers and guidance**

Update imports in `scripts/import-claude-skills.mjs`:

```js
import { createPathOf, readJsonFileIfExists } from './lib/fs-json.mjs';
import { generatedPluginEntry } from './lib/generated-manifest.mjs';
import { PLAYBOOK_FIRST_GUIDANCE } from './lib/playbook-first-guidance.mjs';
```

- [ ] **Step 4: Add an import guidance decision helper**

Add this helper:

```js
function importShouldUsePlaybookFirstGuidance(pathOf, pluginName) {
  const generated = readJsonFileIfExists(pathOf('.agent-trigger-kit/generated.json'), null);
  const existingEntry = generatedPluginEntry(generated, pluginName);
  if (!existingEntry) return true;
  return existingEntry.playbookFirstGuidance?.version === PLAYBOOK_FIRST_GUIDANCE.version;
}
```

- [ ] **Step 5: Add guidance to new import playbook headers**

Change `playbookHeader()` signature:

```js
function playbookHeader(pluginName, maintenanceRef, playbookFirstGuidance = false) {
  const guidanceSection = playbookFirstGuidance
    ? `
## ${PLAYBOOK_FIRST_GUIDANCE.heading}

${PLAYBOOK_FIRST_GUIDANCE.guidance}
`
    : '';
  return `# ${titleize(pluginName)} Playbook

This is the canonical playbook for the ${pluginName} trigger layer.
${guidanceSection}
Imported Claude Code skill bodies live in task sections below. Codex skills, Claude commands, Cursor rules, and pointer docs should stay thin references to this file.

Maintenance contract: \`${maintenanceRef}\`
`;
}
```

- [ ] **Step 6: Thread the decision into import main**

In `main()`, after `const pathOf = createPathOf(root);`, compute:

```js
  const playbookFirstGuidance = importShouldUsePlaybookFirstGuidance(pathOf, pluginName);
```

Move this line after `pluginName` is available if necessary. Use it in the playbook header:

```js
    : playbookHeader(pluginName, maintenanceRef, playbookFirstGuidance);
```

Pass it to `writeTriggerLayer()`:

```js
    playbookFirstGuidance,
```

- [ ] **Step 7: Run focused import tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'brand-new guided plugin|existing unflagged plugin|existing guided plugin flag'
```

Expected: PASS.

- [ ] **Step 8: Run existing importer tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'import-claude-skills'
```

Expected: PASS.

- [ ] **Step 9: Commit this task**

Run:

```bash
git add scripts/import-claude-skills.mjs tests/trigger-layer-scripts.test.mjs
git commit -m "feat: preserve playbook guidance on skill import"
```

Expected: commit succeeds.

---

### Task 5: Add Flag-Gated Validator Checks

**Files:**
- Modify: `scripts/validate-trigger-layer.mjs`
- Test: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Write failing validator tests**

Add these tests near the validator tests:

```js
function writeGuidedSkill(root, pluginDir, task = 'docs-review', options = {}) {
  const description = options.description ?? 'Use for docs review work. Project playbook is source of truth.';
  const guidance =
    options.guidance ??
    'For tasks covered by this project trigger layer, the project playbook is the source of truth; generic helper guidance should align with it, not override it.';
  write(
    root,
    `${pluginDir}/skills/${task}/SKILL.md`,
    `---
name: ${task}
description: ${description}
---

# ${task}

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`

## Checklist

- ${guidance}
- Maintenance contract: \`../../../../.agent-trigger-kit/MAINTENANCE.md\`
`,
  );
}

test('validator accepts old generated manifests without playbook-first flag', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  writeValidSkillAndCommand(root, pluginDir);
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [{ kind: 'skill', path: `${pluginDir}/skills/docs-review/SKILL.md` }],
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('validator fails flagged generated skill missing playbook-first description signal', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  writeGuidedSkill(root, pluginDir, 'docs-review', {
    description: 'Use for docs review work.',
  });
  write(
    root,
    `${pluginDir}/commands/docs-review.md`,
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`,
  );
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbookFirstGuidance: { version: 1 },
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [{ kind: 'skill', path: `${pluginDir}/skills/docs-review/SKILL.md` }],
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing playbook-first description signal/i);
  assert.match(result.stderr, /plugins\/demo-ops\/skills\/docs-review\/SKILL\.md/);
});

test('validator fails flagged generated skill missing playbook-first checklist guidance', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  writeGuidedSkill(root, pluginDir, 'docs-review', {
    guidance: 'Maintenance contract: `../../../../.agent-trigger-kit/MAINTENANCE.md`',
  });
  write(
    root,
    `${pluginDir}/commands/docs-review.md`,
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`,
  );
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbookFirstGuidance: { version: 1 },
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [{ kind: 'skill', path: `${pluginDir}/skills/docs-review/SKILL.md` }],
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing playbook-first checklist guidance/i);
});

test('validator checks playbook-first guidance only for flagged plugins', () => {
  const root = makeRoot();
  createMinimalPlugins(root, ['demo-ops', 'other-ops']);
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  write(root, 'docs/agent-playbooks/other-ops.md', '# Other Ops Playbook');
  writeGuidedSkill(root, 'plugins/demo-ops');
  writeValidSkillAndCommand(root, 'plugins/other-ops');
  write(
    root,
    'plugins/demo-ops/commands/docs-review.md',
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`,
  );
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbookFirstGuidance: { version: 1 },
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [{ kind: 'skill', path: 'plugins/demo-ops/skills/docs-review/SKILL.md' }],
    },
    'other-ops': {
      pluginVersion: '0.1.0',
      playbook: 'docs/agent-playbooks/other-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [{ kind: 'skill', path: 'plugins/other-ops/skills/docs-review/SKILL.md' }],
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
```

- [ ] **Step 2: Run focused validator tests to confirm they fail**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'playbook-first flag|playbook-first description|playbook-first checklist|only for flagged'
```

Expected: FAIL because validator has no playbook-first checks yet.

- [ ] **Step 3: Import guidance helpers in the validator**

Add to `scripts/validate-trigger-layer.mjs`:

```js
import {
  PLAYBOOK_FIRST_GUIDANCE,
  hasPlaybookFirstGuidance,
  hasPlaybookFirstSignal,
} from './lib/playbook-first-guidance.mjs';
```

- [ ] **Step 4: Add the validator function**

Add this function near `validateMaintenanceContractPointers()`:

```js
function validatePlaybookFirstGuidance() {
  const generatedPath = '.agent-trigger-kit/generated.json';
  if (!existsSync(pathOf(generatedPath))) return;

  const generated = parseJson(generatedPath);
  if (!generated) return;

  const normalized = normalizeGeneratedManifest(generated);
  for (const [pluginName, plugin] of Object.entries(normalized.plugins)) {
    if (plugin.playbookFirstGuidance?.version !== PLAYBOOK_FIRST_GUIDANCE.version) continue;

    for (const entry of plugin.files || []) {
      if (entry?.kind !== 'skill' || typeof entry.path !== 'string') continue;
      if (!existsSync(pathOf(entry.path))) continue;

      const text = read(entry.path);
      const frontmatter = parseFrontmatter(entry.path, text);
      const description = frontmatterValue(frontmatter, 'description') || '';
      const remediation =
        'restore the managed wrapper, manually add the missing playbook-first signal/guidance, or remove the plugin playbookFirstGuidance flag to opt out';

      if (!hasPlaybookFirstSignal(description)) {
        fail(
          `${entry.path}: ${pluginName} flagged playbook-first guidance but this generated skill is missing playbook-first description signal; ${remediation}`,
        );
      }

      if (!hasPlaybookFirstGuidance(text)) {
        fail(
          `${entry.path}: ${pluginName} flagged playbook-first guidance but this generated skill is missing playbook-first checklist guidance; ${remediation}`,
        );
      }
    }
  }
}
```

- [ ] **Step 5: Call the validator function**

Near the bottom of `scripts/validate-trigger-layer.mjs`, after `validateMaintenanceContractPointers();`, add:

```js
validatePlaybookFirstGuidance();
```

- [ ] **Step 6: Run focused validator tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'playbook-first flag|playbook-first description|playbook-first checklist|only for flagged'
```

Expected: PASS.

- [ ] **Step 7: Run all validator tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'validator'
```

Expected: PASS.

- [ ] **Step 8: Commit this task**

Run:

```bash
git add scripts/validate-trigger-layer.mjs tests/trigger-layer-scripts.test.mjs
git commit -m "feat: validate playbook-first guidance drift"
```

Expected: commit succeeds.

---

### Task 6: Update Docs And Bump Release Versions

**Files:**
- Modify: `README.md`
- Modify: `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `.agents/plugins/marketplace.json`
- Modify: `plugins/agent-trigger-kit/.codex-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `plugins/agent-trigger-kit/.claude-plugin/plugin.json`
- Test: `tests/open-source-config.test.mjs`
- Test: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Write docs/version expectation tests if needed**

Inspect existing tests:

```bash
node --test tests/open-source-config.test.mjs
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'version check reports matching source versions'
```

Expected before docs edits: PASS. If there is no test asserting `README.md` mentions `--task-descriptions`, add this small test in `tests/open-source-config.test.mjs`:

```js
test('README documents playbook-first task descriptions', () => {
  const readme = read('README.md');
  assert.match(readme, /playbook-first guidance/i);
  assert.match(readme, /--task-descriptions/);
});
```

Run:

```bash
node --test tests/open-source-config.test.mjs --test-name-pattern 'playbook-first task descriptions'
```

Expected if the test was added before docs: FAIL because README is not updated yet.

- [ ] **Step 2: Update README**

In `README.md`, under "Use In A Project", add a short section after the basic `init` example:

```markdown
Generated skills include playbook-first guidance: for tasks covered by the
project trigger layer, the project playbook is the source of truth and generic
helper guidance should align with it instead of overriding it. This signal is
added to generated skill descriptions and skill checklists only; Claude command
shims and Cursor path rules remain thin routing surfaces.

For stronger discovery, provide task-specific trigger descriptions when the
task name alone is not descriptive enough:

```bash
npx --yes github:CCC0509/agent-trigger-kit init \
  --root /path/to/project \
  --plugin <project>-ops \
  --tasks docs-review,deploy-ops \
  --playbook docs/agent-playbooks/<project>-ops.md \
  --task-descriptions '{"docs-review":"Use for docs, playbooks, todo, done-log, review-log, and docs-only closeout."}'
```

Add one sentence after the example noting that task descriptions with punctuation are rendered as quoted frontmatter strings in generated `SKILL.md` files; that is expected and keeps the YAML valid.
```

Ensure the nested fenced block is valid Markdown by using a different fence length if needed.

- [ ] **Step 3: Update the cross-agent trigger layer skill**

In `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md`, add under "Core Model":

```markdown
- Generated project skills carry playbook-first guidance: for covered tasks,
  the project playbook is the source of truth and generic helper guidance should
  align with it rather than override it.
```

Add under "Build Order" after creating wrappers:

```markdown
6. Use task-specific skill descriptions when task names alone are too sparse for discovery.
```

Renumber following items so the list remains ordered.

- [ ] **Step 4: Update CHANGELOG**

Add this section above `## 0.1.6 - Install Scope Guidance`:

```markdown
## 0.1.8 - Playbook-First Guidance

- Added playbook-first guidance to generated project trigger-layer skill
  descriptions and checklists so project playbooks stay visible when generic
  helper skills also match a task.
- Added `init --task-descriptions` for richer task-specific generated skill
  descriptions.
- Added flag-gated validation for generated skill guidance drift.
```

If implementation confirms `0.1.7` was already released without a changelog entry, add a short `0.1.7` section between `0.1.8` and `0.1.6`:

```markdown
## 0.1.7 - Claude Skill Importer

- Added `agent-trigger-kit import-claude-skills` for migrating existing Claude
  Code skills into project-local cross-agent trigger layers while preserving
  descriptions.
```

- [ ] **Step 5: Bump aligned versions**

Change `0.1.7` to `0.1.8` in:

```text
package.json
.agents/plugins/marketplace.json
plugins/agent-trigger-kit/.codex-plugin/plugin.json
.claude-plugin/marketplace.json
plugins/agent-trigger-kit/.claude-plugin/plugin.json
```

Use the repo helper if preferred:

```bash
node scripts/bump-plugin-version.mjs --root . --plugin agent-trigger-kit --version 0.1.8
```

Expected: the five version surfaces are all `0.1.8`.

- [ ] **Step 6: Run docs and version checks**

Run:

```bash
node --test tests/open-source-config.test.mjs
npm run ops:plugin-version-check -- --surface source agent-trigger-kit
```

Expected: PASS, with source expected version `0.1.8`.

- [ ] **Step 7: Commit this task**

Run:

```bash
git add README.md plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md CHANGELOG.md package.json .agents/plugins/marketplace.json plugins/agent-trigger-kit/.codex-plugin/plugin.json .claude-plugin/marketplace.json plugins/agent-trigger-kit/.claude-plugin/plugin.json tests/open-source-config.test.mjs
git commit -m "docs: document playbook-first trigger guidance"
```

Expected: commit succeeds.

---

### Task 7: Final Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run formatting check**

Run:

```bash
npm run format:check
```

Expected: PASS. If it fails, run `npm run format`, inspect the diff, and repeat `npm run format:check`.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS with all tests passing.

- [ ] **Step 4: Run project trigger-layer validation**

Run:

```bash
npm run validate
```

Expected: PASS with `trigger layer validation passed for .`.

- [ ] **Step 5: Run source version check**

Run:

```bash
npm run ops:plugin-version-check -- --surface source agent-trigger-kit
```

Expected: PASS and all source surfaces report `0.1.8`.

- [ ] **Step 6: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
git diff --check HEAD
```

Expected: only intended feature, docs, tests, and version files are changed; `git diff --check HEAD` reports no whitespace errors.

- [ ] **Step 7: Commit verification fixes if any**

If Step 1 through Step 6 required formatting or small fixes, commit them:

```bash
git add .
git commit -m "chore: verify playbook-first guidance release"
```

Expected: commit succeeds if there were additional fixes. If there were no changes, skip this step.

---

## Self-Review

- Spec coverage: The plan covers the guidance module, separate signal and guidance text, generator option threading, skill template placeholder, manifest flag persistence, `init --task-descriptions`, conservative import behavior, flag-gated validator checks, docs, aligned version bump, and final verification.
- Known limitation captured: Incremental import still replaces the generated manifest plugin entry with the current run's files, so validator checks manifest-owned generated skills rather than every on-disk skill wrapper.
- Deferred scope preserved: Pointer docs, managed regions, command/Cursor guidance signals, and task-specific guidance profiles are not implemented in this plan.
