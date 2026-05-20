# Import Claude Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `agent-trigger-kit import-claude-skills` so existing Claude Code skills can seed a project-local cross-agent trigger layer without losing trigger descriptions.

**Architecture:** Extract the current trigger-layer generation core from `scripts/init-project-trigger-layer.mjs` into `scripts/lib/trigger-layer.mjs`, then reuse it from both `init` and the new importer. The importer parses Claude skill frontmatter and body, builds a candidate canonical playbook, fails fast on validator-incompatible duplicate heading slugs, passes real descriptions into the shared wrapper generator, writes the playbook only after wrapper generation succeeds, and deletes source skills after a successful import unless `--keep-source` is explicit.

**Tech Stack:** Node.js ESM scripts, `node:test`, existing JSON/file helpers, current Markdown templates, no new runtime dependencies.

---

## File Structure

- Create `scripts/lib/trigger-layer.mjs`
  - Owns shared trigger-layer generation: marketplace upserts, plugin manifests, maintenance contract, wrapper rendering, force/checksum protection, and `.agent-trigger-kit/generated.json`.
  - Exports `writeTriggerLayer()`, `titleize()`, `markdownRelativePath()`, and `taskDescriptionFor()`.
- Modify `scripts/init-project-trigger-layer.mjs`
  - Keep CLI argument parsing.
  - Call `writeTriggerLayer()` with generated default task descriptions.
  - Preserve current output and behavior.
- Create `scripts/import-claude-skills.mjs`
  - Owns importer-specific parsing and migration flow.
  - Exports pure helpers for tests: `parseClaudeSkill()`, `validateImportedTaskName()`, `normalizeSkillBodyForPlaybook()`, `upsertPlaybookSection()`, `findDuplicateHeadingSlugs()`, `assertNoDuplicateHeadingSlugs()`, and `lintClaudeOnlyToolRefs()`.
  - Runs CLI `main()` only when executed directly.
- Modify `scripts/cli.mjs`
  - Add `import-claude-skills` dispatcher entry and usage line.
- Modify `tests/trigger-layer-scripts.test.mjs`
  - Add unit tests for importer helpers.
  - Add integration tests for CLI importer behavior.
  - Keep existing init/validate/clean tests passing after extraction.
- Modify `README.md`
  - Document the importer command, source deletion behavior, playbook section conflict behavior, and warnings.
- Modify `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md`
  - Mention the importer as the preferred path for existing Claude Code skills.
  - This is plugin-visible and requires an aligned plugin version bump before completion.

---

### Task 1: Add Shared Trigger-Layer Generator Without Behavior Changes

**Files:**

- Create: `scripts/lib/trigger-layer.mjs`
- Modify: `scripts/init-project-trigger-layer.mjs`
- Test: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Run the current characterization tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: PASS. This is the baseline before extracting shared generation code.

- [ ] **Step 2: Create the shared generator file**

Create `scripts/lib/trigger-layer.mjs` by moving the generation helpers out of `scripts/init-project-trigger-layer.mjs`. The exported public surface should be:

```js
export const DEFAULT_MAINTENANCE_CONTRACT = '.agent-trigger-kit/MAINTENANCE.md';
export const TEMPLATE_VERSION = 1;

export function titleize(name) {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function markdownRelativePath(fromDir, toPath) {
  return relative(fromDir, toPath).replaceAll('\\', '/');
}

export function taskDescriptionFor(task) {
  return `Use for ${titleize(task).toLowerCase()} work in this repo.`;
}

export function writeTriggerLayer(options) {
  const context = createWriteContext(options);
  context.preflightForceOverwrites();
  context.upsertCodexMarketplace();
  context.upsertClaudeMarketplace();
  if (context.writePlaybookPlaceholder) context.writePlaybookPlaceholderFile();
  context.writeMaintenanceContract();
  context.writePluginManifests();
  context.writeTaskWrappers();
  context.writeGeneratedManifest();
  context.printSummary();
  return {
    pluginVersion: context.pluginVersion,
    generatedFiles: context.generatedFiles,
  };
}
```

Implement `createWriteContext(options)` as a local helper that captures the current moved state from `init`: `root`, `pathOf`, `pluginName`, `pluginDir`, `tasks`, `playbook`, `force`, `initialVersion`, `cursorGlobs`, `taskDescriptions`, `writePlaybookPlaceholder`, `generatedFiles`, `previousGeneratedManifest`, `generatedTargets`, and `pluginVersion`. Default `writePlaybookPlaceholder` to `true` inside `createWriteContext()` so `init` keeps creating the canonical playbook placeholder unless a caller explicitly disables it. Preserve the current behavior from `init`: existing version discovery, `--force` checksum verification for generated files, Codex/Claude marketplace writes, maintenance contract writes, plugin manifest writes, wrapper rendering, generated manifest writes, and the `skipped Cursor rules` log when no cursor globs are supplied.

When moving the existing package metadata read into `scripts/lib/trigger-layer.mjs`, update the relative URL depth:

```js
const kitPackage = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
```

- [ ] **Step 3: Make task descriptions injectable**

When rendering skill and command wrappers, compute:

```js
const description = taskDescriptions.get(task) || taskDescriptionFor(task);
```

Use that description in both:

```js
renderTemplate(wrapperTemplates.skill, values);
renderTemplate(wrapperTemplates.command, values);
```

Expected: `init` still produces the previous `Use for docs review work in this repo.` description, while importer can pass the original Claude skill description.

- [ ] **Step 4: Refactor init to call the shared generator**

Reduce `scripts/init-project-trigger-layer.mjs` to argument parsing plus one call:

```js
#!/usr/bin/env node
import { normalize } from 'node:path';

import { parseArgs, requiredArg } from './lib/args.mjs';
import { writeTriggerLayer } from './lib/trigger-layer.mjs';

const args = parseArgs(process.argv.slice(2));
const root = normalize(requiredArg(args, 'root'));
const pluginName = requiredArg(args, 'plugin');
const tasks = requiredArg(args, 'tasks')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const playbook = requiredArg(args, 'playbook');
const cursorGlobs = args['cursor-globs']
  ? args['cursor-globs']
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  : [];

writeTriggerLayer({
  root,
  pluginName,
  tasks,
  playbook,
  cursorGlobs,
  force: Boolean(args.force),
  initialVersion: args['initial-version'] || '0.1.0',
  writePlaybookPlaceholder: true,
});
```

- [ ] **Step 5: Run the characterization tests again**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: PASS. If a failure shows output differences, either preserve the previous output or update only tests whose assertions were coupled to moved code paths, not behavior.

---

### Task 2: Add Pure Importer Helpers With Unit Tests

**Files:**

- Create: `scripts/import-claude-skills.mjs`
- Modify: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Add imports for helper tests**

At the top of `tests/trigger-layer-scripts.test.mjs`, import the future helpers:

```js
import {
  assertNoDuplicateHeadingSlugs,
  findDuplicateHeadingSlugs,
  lintClaudeOnlyToolRefs,
  normalizeSkillBodyForPlaybook,
  parseClaudeSkill,
  upsertPlaybookSection,
  validateImportedTaskName,
} from '../scripts/import-claude-skills.mjs';
```

- [ ] **Step 2: Write failing frontmatter parsing tests**

Add:

```js
test('parseClaudeSkill extracts required frontmatter and body', () => {
  const parsed = parseClaudeSkill(
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Read README changes.
`,
    '.claude/skills/docs-review/SKILL.md',
  );

  assert.deepEqual(parsed, {
    name: 'docs-review',
    description: 'Review docs before release.',
    body: '# Docs Review\n\nRead README changes.\n',
  });
});

test('parseClaudeSkill fails when name or description is missing', () => {
  assert.throws(
    () =>
      parseClaudeSkill(
        `---
name: docs-review
---

Body.
`,
        '.claude/skills/docs-review/SKILL.md',
      ),
    /missing required frontmatter key description/i,
  );
});

test('parseClaudeSkill normalizes CRLF and rejects unsupported block scalars', () => {
  const parsed = parseClaudeSkill(
    '---\r\nname: docs-review\r\ndescription: Review docs.\r\n---\r\n\r\nBody.\r\n',
    '.claude/skills/docs-review/SKILL.md',
  );
  assert.equal(parsed.body, '\nBody.\n');
  assert.throws(
    () =>
      parseClaudeSkill(
        `---
name: docs-review
description: >
  Review docs.
---

Body.
`,
        '.claude/skills/docs-review/SKILL.md',
      ),
    /block scalar frontmatter is not supported/i,
  );
});
```

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: FAIL because `scripts/import-claude-skills.mjs` does not exist yet.

- [ ] **Step 3: Implement frontmatter parsing**

Create `scripts/import-claude-skills.mjs` with exported helpers and no CLI side effects yet:

```js
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs, requiredArg } from './lib/args.mjs';
import { createPathOf } from './lib/fs-json.mjs';
import { markdownRelativePath, titleize, writeTriggerLayer } from './lib/trigger-layer.mjs';

export function parseClaudeSkill(text, path) {
  const normalizedText = text.replace(/\r\n/g, '\n');
  const match = normalizedText.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`${path}: missing frontmatter`);
  }

  const frontmatter = match[1];
  const body = match[2];
  const values = {};
  for (const line of frontmatter.split('\n')) {
    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (keyValue) values[keyValue[1]] = keyValue[2].replace(/^['"]|['"]$/g, '');
  }

  for (const key of ['name', 'description']) {
    if (!values[key]) {
      throw new Error(`${path}: missing required frontmatter key ${key}`);
    }
    if (values[key] === '>' || values[key] === '|') {
      throw new Error(`${path}: block scalar frontmatter is not supported for ${key}`);
    }
  }

  return {
    name: values.name,
    description: values.description,
    body,
  };
}
```

- [ ] **Step 4: Write failing task-name validation tests**

Add:

```js
test('validateImportedTaskName accepts clean kebab slugs only', () => {
  assert.equal(validateImportedTaskName('docs-review', 'skill name'), 'docs-review');
  assert.throws(
    () => validateImportedTaskName('Docs Review', 'skill name'),
    /must be a clean kebab slug/i,
  );
  assert.throws(
    () => validateImportedTaskName('docs_review', 'skill name'),
    /must be a clean kebab slug/i,
  );
});
```

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: FAIL because `validateImportedTaskName()` is not implemented.

- [ ] **Step 5: Implement task-name validation**

Add:

```js
export function validateImportedTaskName(taskName, label = 'task name') {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(taskName)) {
    throw new Error(`${label} must be a clean kebab slug: ${taskName}`);
  }
  return taskName;
}
```

- [ ] **Step 6: Write failing body normalization tests**

Add:

````js
test('normalizeSkillBodyForPlaybook strips leading h1 and demotes headings outside fences', () => {
  const body = [
    '# Docs Review',
    '',
    'Intro.',
    '',
    '```bash',
    '# shell comment',
    '## literal code heading',
    '```',
    '',
    '## Checklist',
    '',
    '- Read docs.',
    '',
  ].join('\n');
  const expected = [
    'Intro.',
    '',
    '```bash',
    '# shell comment',
    '## literal code heading',
    '```',
    '',
    '### Checklist',
    '',
    '- Read docs.',
    '',
  ].join('\n');

  assert.equal(normalizeSkillBodyForPlaybook(body), expected);
});
````

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: FAIL because `normalizeSkillBodyForPlaybook()` is not implemented.

- [ ] **Step 7: Implement body normalization**

Add:

````js
function stripLeadingH1(body) {
  const lines = body.replace(/\s+$/u, '').split('\n');
  const firstContent = lines.findIndex((line) => line.trim() !== '');
  if (firstContent === -1) return '';
  if (!/^#\s+/.test(lines[firstContent])) return `${lines.join('\n').trim()}\n`;
  lines.splice(firstContent, 1);
  while (lines[firstContent]?.trim() === '') lines.splice(firstContent, 1);
  return `${lines.join('\n').trim()}\n`;
}

export function normalizeSkillBodyForPlaybook(body) {
  let inFence = false;
  return stripLeadingH1(body)
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      const match = line.match(/^(\s{0,3})(#{1,5})(\s+.*)$/);
      if (!match) return line;
      return `${match[1]}${'#'.repeat(match[2].length + 1)}${match[3]}`;
    })
    .join('\n');
}
````

- [ ] **Step 8: Write failing playbook section upsert tests**

Add:

```js
test('upsertPlaybookSection appends new task section and rejects accidental replacement', () => {
  const initial = '# Demo Ops Playbook\n\nIntro.\n';
  const updated = upsertPlaybookSection(initial, {
    task: 'docs-review',
    body: 'Review docs.\n',
  });

  assert.match(updated, /^# Demo Ops Playbook\n\nIntro\.\n\n## docs-review\n\nReview docs\.\n$/);
  assert.throws(
    () =>
      upsertPlaybookSection(updated, {
        task: 'docs-review',
        body: 'Replacement.\n',
      }),
    /already has section ## docs-review/i,
  );
});

test('upsertPlaybookSection replaces existing section only when requested', () => {
  const updated = upsertPlaybookSection(
    '# Demo\n\n## docs-review\n\nOld.\n\n## deploy-ops\n\nDeploy.\n',
    {
      task: 'docs-review',
      body: 'New.\n',
      replace: true,
    },
  );

  assert.equal(updated, '# Demo\n\n## docs-review\n\nNew.\n\n## deploy-ops\n\nDeploy.\n');
});
```

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: FAIL because `upsertPlaybookSection()` is not implemented.

- [ ] **Step 9: Implement playbook section upsert**

Add:

```js
export function upsertPlaybookSection(playbookText, { task, body, replace = false }) {
  const normalizedBody = body.trimEnd();
  const section = `## ${task}\n\n${normalizedBody}\n`;
  const sectionPattern = new RegExp(
    `(^|\n)## ${task.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n[\\s\\S]*?(?=\\n## |$)`,
  );
  const match = playbookText.match(sectionPattern);

  if (!match) {
    return `${playbookText.trimEnd()}\n\n${section}`;
  }

  if (!replace) {
    throw new Error(`playbook already has section ## ${task}; pass --replace-playbook-section`);
  }

  const prefix = match[1] || '';
  return playbookText.replace(sectionPattern, `${prefix}${section.trimEnd()}`);
}
```

- [ ] **Step 10: Write failing duplicate heading slug tests**

Add:

```js
test('assertNoDuplicateHeadingSlugs rejects validator-incompatible playbooks', () => {
  assert.throws(
    () =>
      assertNoDuplicateHeadingSlugs(`# Demo

## docs-review

### Checklist

## deploy-ops

### Checklist
`),
    /duplicate heading slug checklist/i,
  );
});

test('findDuplicateHeadingSlugs uses validator-compatible simplified slugs', () => {
  assert.deepEqual(
    findDuplicateHeadingSlugs(`# Demo

## Use The Thing!

## use-the-thing
`),
    [
      {
        slug: 'use-the-thing',
        headings: ['Use The Thing!', 'use-the-thing'],
      },
    ],
  );
});
```

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: FAIL because `findDuplicateHeadingSlugs()` and `assertNoDuplicateHeadingSlugs()` are not implemented.

- [ ] **Step 11: Implement duplicate heading slug detection**

Add:

```js
function simplifiedHeadingSlug(heading) {
  return heading
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function findDuplicateHeadingSlugs(markdownText) {
  const seen = new Map();
  const duplicates = new Map();

  for (const line of markdownText.split('\n')) {
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const heading = match[1];
    const slug = simplifiedHeadingSlug(heading);
    if (!slug) continue;

    if (!seen.has(slug)) {
      seen.set(slug, heading);
      continue;
    }

    const headings = duplicates.get(slug) || [seen.get(slug)];
    headings.push(heading);
    duplicates.set(slug, headings);
  }

  return [...duplicates.entries()].map(([slug, headings]) => ({ slug, headings }));
}

export function assertNoDuplicateHeadingSlugs(markdownText) {
  const duplicates = findDuplicateHeadingSlugs(markdownText);
  if (duplicates.length === 0) return;

  const details = duplicates
    .map((entry) => `${entry.slug} (${entry.headings.join(' / ')})`)
    .join(', ');
  throw new Error(`playbook would contain duplicate heading slug ${details}`);
}
```

This intentionally mirrors `scripts/validate-trigger-layer.mjs` heading-slug behavior, including its simple Markdown scan, so the importer fails before generating a playbook that this repo's validator would reject.

- [ ] **Step 12: Write failing Claude-only tool lint tests**

Add:

```js
test('lintClaudeOnlyToolRefs warns for conservative Claude tool references', () => {
  assert.deepEqual(lintClaudeOnlyToolRefs('Use the TodoWrite tool, then call `Task`.'), [
    'Task',
    'TodoWrite',
  ]);
  assert.deepEqual(lintClaudeOnlyToolRefs('Use normal shell commands.'), []);
});
```

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: FAIL because `lintClaudeOnlyToolRefs()` is not implemented.

- [ ] **Step 13: Implement Claude-only tool lint**

Add:

```js
const CLAUDE_ONLY_TOOL_NAMES = ['Task', 'TodoWrite'];

export function lintClaudeOnlyToolRefs(text) {
  const found = new Set();
  for (const toolName of CLAUDE_ONLY_TOOL_NAMES) {
    const escaped = toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\`${escaped}\``).test(text)) found.add(toolName);
    if (new RegExp(`\\buse the ${escaped} tool\\b`, 'i').test(text)) found.add(toolName);
  }
  return [...found].sort();
}
```

- [ ] **Step 14: Run helper tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: PASS for the new helper tests and existing tests.

---

### Task 3: Implement Import CLI Flow

**Files:**

- Modify: `scripts/import-claude-skills.mjs`
- Modify: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Write failing integration test for importing two skills**

Add this test:

```js
test('import-claude-skills seeds playbook and generated trigger wrappers', () => {
  const root = makeRoot();
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Use the TodoWrite tool before editing docs.

## Checklist

- Read README.
`,
  );
  write(
    root,
    '.claude/skills/deploy-ops/SKILL.md',
    `---
name: deploy-ops
description: Use when preparing deployments.
---

# Deploy Ops

Confirm release state.
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
  assert.match(result.stderr, /docs-review.*TodoWrite/i);
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), false);

  const playbook = readFileSync(join(root, 'docs/agent-playbooks/demo-ops.md'), 'utf8');
  assert.match(playbook, /Maintenance contract: `..\/..\/.agent-trigger-kit\/MAINTENANCE.md`/);
  assert.match(playbook, /## docs-review\n\nUse the TodoWrite tool before editing docs\./);
  assert.match(playbook, /### Checklist/);
  assert.match(playbook, /## deploy-ops\n\nConfirm release state\./);

  const wrapper = readFileSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md'), 'utf8');
  assert.match(wrapper, /description: Review docs before release\./);

  const generated = generatedPluginEntry(root);
  assert.deepEqual(generated.tasks, ['docs-review', 'deploy-ops']);
  assert.equal(
    generated.files.some((file) => file.path === 'plugins/demo-ops/skills/docs-review/SKILL.md'),
    true,
  );

  const validate = runScript('validate-trigger-layer.mjs', ['--root', root]);
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);
});
```

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: FAIL because `main()` is not implemented.

- [ ] **Step 2: Implement source discovery and CLI argument parsing**

In `scripts/import-claude-skills.mjs`, add:

```js
function selectedSkillDirs(root, source, selectedSkills) {
  const sourcePath = join(root, source);
  if (!existsSync(sourcePath)) {
    throw new Error(`${source}: source directory does not exist`);
  }

  const names = selectedSkills.length > 0 ? selectedSkills : readdirSync(sourcePath);
  const dirs = names
    .map((name) => ({ name, skillPath: join(sourcePath, name, 'SKILL.md') }))
    .filter((entry) => existsSync(entry.skillPath));

  if (dirs.length === 0) {
    throw new Error(`${source}: no skill directories with SKILL.md found`);
  }

  return dirs;
}

function parseCommaList(value) {
  return value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}
```

- [ ] **Step 3: Implement missing playbook creation for import**

Add:

```js
function playbookHeader(pluginName, maintenanceRef) {
  return `# ${titleize(pluginName)} Playbook

This is the canonical playbook for the ${pluginName} trigger layer.

Imported Claude Code skill bodies live in task sections below. Codex skills, Claude commands, Cursor rules, and pointer docs should stay thin references to this file.

Maintenance contract: \`${maintenanceRef}\`
`;
}
```

Use `titleize()` from the shared lib.

- [ ] **Step 4: Implement import `main()`**

Add:

```js
export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, {
    booleanKeys: ['force', 'keep-source', 'replace-playbook-section'],
  });
  const root = normalize(requiredArg(args, 'root'));
  const pathOf = createPathOf(root);
  const source = requiredArg(args, 'source');
  const pluginName = requiredArg(args, 'plugin');
  const playbook = requiredArg(args, 'playbook');
  const selectedSkills = parseCommaList(args.skills);
  const cursorGlobs = parseCommaList(args['cursor-globs']);

  const imported = [];
  const warnings = [];
  for (const entry of selectedSkillDirs(root, source, selectedSkills)) {
    const parsed = parseClaudeSkill(readFileSync(entry.skillPath, 'utf8'), entry.skillPath);
    const task = validateImportedTaskName(parsed.name, `${entry.name} frontmatter name`);
    if (task !== entry.name) {
      console.error(`warning: ${entry.name} directory imports task ${task}`);
    }
    const toolRefs = lintClaudeOnlyToolRefs(parsed.body);
    if (toolRefs.length > 0) {
      warnings.push(`${task}: Claude-specific tool references found: ${toolRefs.join(', ')}`);
    }
    imported.push({
      task,
      description: parsed.description,
      body: normalizeSkillBodyForPlaybook(parsed.body),
      sourcePath: entry.skillPath,
    });
  }

  const taskNames = imported.map((item) => item.task);
  if (new Set(taskNames).size !== taskNames.length) {
    throw new Error(`duplicate imported skill names: ${taskNames.join(', ')}`);
  }

  const playbookPath = pathOf(playbook);
  const maintenanceRef = markdownRelativePath(
    dirname(playbook),
    '.agent-trigger-kit/MAINTENANCE.md',
  );
  let playbookText = existsSync(playbookPath)
    ? readFileSync(playbookPath, 'utf8')
    : playbookHeader(pluginName, maintenanceRef);

  for (const item of imported) {
    playbookText = upsertPlaybookSection(playbookText, {
      task: item.task,
      body: item.body,
      replace: Boolean(args['replace-playbook-section']),
    });
  }
  assertNoDuplicateHeadingSlugs(playbookText);

  writeTriggerLayer({
    root,
    pluginName,
    tasks: taskNames,
    playbook,
    cursorGlobs,
    force: Boolean(args.force),
    initialVersion: args['initial-version'] || '0.1.0',
    taskDescriptions: new Map(imported.map((item) => [item.task, item.description])),
    writePlaybookPlaceholder: false,
  });

  mkdirSync(dirname(playbookPath), { recursive: true });
  writeFileSync(playbookPath, `${playbookText.trimEnd()}\n`);

  for (const warning of warnings) {
    console.error(`warning: ${warning}; consider rewriting the playbook in cross-agent terms`);
  }

  if (!args['keep-source']) {
    for (const item of imported) {
      rmSync(dirname(item.sourcePath), { recursive: true, force: true });
      console.log(`deleted ${resolve(item.sourcePath)}`);
    }
  }

  console.log(`imported ${imported.length} Claude skill(s) into ${pluginName}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
```

- [ ] **Step 5: Run integration test**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: PASS for helper and import integration tests.

---

### Task 4: Add Safety Tests for Destructive and Replacement Behavior

**Files:**

- Modify: `tests/trigger-layer-scripts.test.mjs`
- Modify: `scripts/import-claude-skills.mjs`

- [ ] **Step 1: Test source deletion is the default after success**

Add:

```js
test('import-claude-skills deletes source by default after successful import', () => {
  const root = makeRoot();
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs.
---

Body.
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
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), false);
});
```

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: PASS if Task 3 implemented deletion after successful writes.

- [ ] **Step 2: Test `--keep-source` preserves source after success**

Add:

```js
test('import-claude-skills keeps source with --keep-source', () => {
  const root = makeRoot();
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs.
---

Body.
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
    '--keep-source',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), true);
});
```

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Test existing playbook section failure leaves source untouched**

Add:

```js
test('import-claude-skills refuses existing playbook section without replacement flag', () => {
  const root = makeRoot();
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo\n\n## docs-review\n\nExisting.\n');
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs.
---

New body.
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

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already has section ## docs-review/i);
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), true);
});
```

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: PASS. The failure occurs before wrapper writes and before deletion.

- [ ] **Step 4: Test `--replace-playbook-section` allows replacement**

Add:

```js
test('import-claude-skills replaces playbook section with explicit flag', () => {
  const root = makeRoot();
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo\n\n## docs-review\n\nExisting.\n');
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs.
---

New body.
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
    '--replace-playbook-section',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    readFileSync(join(root, 'docs/agent-playbooks/demo-ops.md'), 'utf8'),
    '# Demo\n\n## docs-review\n\nNew body.\n',
  );
});
```

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Test `--skills` imports only selected source skills**

Add:

```js
test('import-claude-skills supports importing selected skills', () => {
  const root = makeRoot();
  for (const skill of ['docs-review', 'deploy-ops']) {
    write(
      root,
      `.claude/skills/${skill}/SKILL.md`,
      `---
name: ${skill}
description: ${skill} description.
---

${skill} body.
`,
    );
  }

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--skills',
    'deploy-ops',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const playbook = readFileSync(join(root, 'docs/agent-playbooks/demo-ops.md'), 'utf8');
  assert.doesNotMatch(playbook, /## docs-review/);
  assert.match(playbook, /## deploy-ops/);
});
```

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Test duplicate heading slug preflight leaves project untouched**

Add:

```js
test('import-claude-skills fails before writes when imported bodies duplicate heading slugs', () => {
  const root = makeRoot();
  for (const skill of ['docs-review', 'deploy-ops']) {
    write(
      root,
      `.claude/skills/${skill}/SKILL.md`,
      `---
name: ${skill}
description: ${skill} description.
---

# ${skill}

## Checklist

- ${skill}
`,
    );
  }

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

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate heading slug checklist/i);
  assert.equal(existsSync(join(root, 'docs/agent-playbooks/demo-ops.md')), false);
  assert.equal(existsSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md')), false);
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), true);
});
```

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: PASS. The duplicate-slug check runs before wrapper writes, playbook writes, and source deletion.

---

### Task 5: Add CLI Dispatch and README Documentation

**Files:**

- Modify: `scripts/cli.mjs`
- Modify: `README.md`
- Modify: `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md`
- Test: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Write failing CLI dispatch test**

Add:

```js
test('cli routes import-claude-skills command to the importer', () => {
  const root = makeRoot();
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs.
---

Review docs body.
`,
  );

  const result = runCli([
    'import-claude-skills',
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
  assert.equal(existsSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md')), true);
});
```

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: FAIL with `Unknown command: import-claude-skills`.

- [ ] **Step 2: Add CLI dispatch**

Modify `scripts/cli.mjs`:

```js
const commands = {
  clean: 'clean-generated-trigger-layer.mjs',
  'import-claude-skills': 'import-claude-skills.mjs',
  init: 'init-project-trigger-layer.mjs',
  validate: 'validate-trigger-layer.mjs',
  'version-check': 'check-plugin-version.mjs',
};
```

Update usage:

```js
'  import-claude-skills  Import Claude Code skills into a cross-agent trigger layer',
```

- [ ] **Step 3: Document the importer in README**

Add a section near "Use In A Project":

````markdown
### Import Existing Claude Code Skills

Use `import-claude-skills` when a project already has Claude Code skills that
should become cross-agent trigger-layer tasks:

```bash
npx --yes github:CCC0509/agent-trigger-kit import-claude-skills \
  --root /path/to/project \
  --source .claude/skills \
  --plugin <project>-ops \
  --playbook docs/agent-playbooks/<project>-ops.md
```

The importer preserves each skill's `description` for trigger quality, moves the
skill body into a `## <task>` playbook section, and generates the same Codex,
Claude Code, and Cursor wrapper surfaces as `init`. Source skills are deleted
after a successful import; pass `--keep-source` when you want to inspect or
remove the old Claude-only skills manually. Existing playbook sections are
protected by default; pass `--replace-playbook-section` to intentionally replace
an imported task section.

If imported skill bodies mention Claude-only tool names such as `TodoWrite` or
`Task`, the importer prints warnings so you can rewrite the canonical playbook
in cross-agent terms.
````

- [ ] **Step 4: Update the agent-facing cross-agent skill**

Modify `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md` so agents discover the importer during future setup work. Add this bullet under the core model or build-order guidance:

```markdown
- For existing Claude Code skills, use `agent-trigger-kit import-claude-skills` to seed the canonical playbook and generate cross-agent wrappers while preserving skill descriptions; imported source skills are deleted after success unless `--keep-source` is passed.
```

Because this is a plugin-visible skill change, Task 6 must bump the aligned plugin version before completion.

- [ ] **Step 5: Run CLI tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: PASS.

---

### Task 6: Full Verification and Completion Checks

**Files:**

- Modify: `package.json`
- Modify: `.agents/plugins/marketplace.json`
- Modify: `plugins/agent-trigger-kit/.codex-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `plugins/agent-trigger-kit/.claude-plugin/plugin.json`
- No other new source files unless previous tasks expose a small fix.

- [ ] **Step 1: Bump the aligned plugin version**

Task 5 changes `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md`, which is plugin-visible. Run the aligned bump before final verification:

```bash
node scripts/bump-plugin-version.mjs --root . --plugin agent-trigger-kit --next patch
```

Expected: aligned versions update in `package.json`, Codex marketplace, Codex plugin manifest, Claude marketplace, and Claude plugin manifest.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run trigger-layer validation for this repo**

Run:

```bash
npm run validate
```

Expected: PASS with `trigger layer validation passed`.

- [ ] **Step 5: Check formatting**

Run:

```bash
npm run format:check
```

Expected: PASS. If it fails only for touched files, run `npm run format -- <path>` or `npx prettier --write <path>` and rerun the check.

- [ ] **Step 6: Check git status**

Run:

```bash
git status --short
```

Expected: only intentional files are changed:

```text
 M .agents/plugins/marketplace.json
 M .claude-plugin/marketplace.json
 M README.md
 M package.json
 M scripts/cli.mjs
 M scripts/init-project-trigger-layer.mjs
 A scripts/import-claude-skills.mjs
 A scripts/lib/trigger-layer.mjs
 M plugins/agent-trigger-kit/.codex-plugin/plugin.json
 M plugins/agent-trigger-kit/.claude-plugin/plugin.json
 M plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md
 M tests/trigger-layer-scripts.test.mjs
```

If this plan document is still uncommitted because the plan was created in the same branch, it may also appear:

```text
?? docs/superpowers/plans/2026-05-20-import-claude-skills.md
```

- [ ] **Step 7: Confirm plugin-visible changes were bumped**

Run:

```bash
git diff --name-only
```

Expected: because plugin-visible files changed, the diff also includes the aligned version files from Step 1. Do not finish with a plugin skill change unless `package.json`, `.agents/plugins/marketplace.json`, `plugins/agent-trigger-kit/.codex-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `plugins/agent-trigger-kit/.claude-plugin/plugin.json` all moved together.

---

## Self-Review

- Spec coverage: The plan covers shared generator extraction, importer parsing, true description preservation, playbook section upsert, duplicate heading slug preflight, source deletion by default with `--keep-source`, playbook replacement safety, Claude-only tool warnings, CLI dispatch, README docs, agent-facing skill discovery, and verification.
- Scope: The validator is intentionally unchanged because the importer preflights validator-incompatible duplicate heading slugs before writing, while semantic tool-name warnings remain import-time only.
- Safety: Source deletion happens only after wrapper generation and playbook writes succeed; `--keep-source` preserves source skills; playbook replacement is explicit with `--replace-playbook-section`; generated wrapper overwrite keeps existing `--force` checksum behavior.
- Test strategy: The plan adds pure helper tests first, then integration tests against temporary project roots, then CLI routing and full repo checks.
- Known limitation: frontmatter parsing supports simple single-line `name` and `description` only; YAML block scalars fail fast instead of being interpreted.
