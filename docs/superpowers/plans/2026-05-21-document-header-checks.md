# Opt-In Document Header Checks Implementation Plan

Status: Draft

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add generic opt-in document header checks to the existing
trigger-layer validator, with a flag-gated Superpowers plan/spec config for
greenfield projects.

**Architecture:** Preserve the existing single validation entry point and
generated manifest source of truth. Add a small `document-header-checks` helper
for config validation, local glob expansion, and top-line matching; wire it
from `validate-trigger-layer.mjs`; teach `writeTriggerLayer()` to preserve and
optionally write `headerChecks`; update docs, plugin-visible trigger guidance,
and aligned versions.

**Tech Stack:** Node.js ESM scripts, `node:test`, existing JSON/file helpers,
no new runtime dependencies.

---

## File Structure

- Create: `scripts/lib/document-header-checks.mjs`
  - Owns header check config validation, glob expansion, exclude matching,
    header-line reading, regex matching, and failure construction.
- Modify: `scripts/lib/generated-manifest.mjs`
  - Preserves `headerChecks` on normalized and upserted plugin entries.
- Modify: `scripts/lib/trigger-layer.mjs`
  - Accepts optional `headerChecks` when writing the generated manifest and
    includes a maintenance-contract example stub for inactive config.
- Modify: `scripts/init-project-trigger-layer.mjs`
  - Parses `--with-superpowers-gate` as a boolean flag and passes the active
    Superpowers check only when requested.
- Modify: `scripts/validate-trigger-layer.mjs`
  - Calls the new helper after generated manifest parsing; absent config is
    no-op.
- Modify: `tests/trigger-layer-scripts.test.mjs`
  - Adds unit tests for config/matching helpers and integration tests for init
    and validator behavior.
- Modify: `README.md`
  - Documents generic `headerChecks`, the Superpowers example, no-op defaults,
    and `--with-superpowers-gate`.
- Modify: `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md`
  - Adds the opt-in document header validation reminder.
- Modify: `plugins/agent-trigger-kit/commands/trigger-layer-init.md`
  - Mentions the explicit Superpowers gate flag.
- Modify: `plugins/agent-trigger-kit/commands/trigger-layer-validate.md`
  - Mentions configured header checks and the missing-header failure shape.
- Modify: `CHANGELOG.md`
  - Adds the release entry.
- Modify: `package.json`, `package-lock.json`,
  `.agents/plugins/marketplace.json`,
  `plugins/agent-trigger-kit/.codex-plugin/plugin.json`,
  `.claude-plugin/marketplace.json`, and
  `plugins/agent-trigger-kit/.claude-plugin/plugin.json`
  - Bumps aligned release versions after plugin-visible files change.

## Execution Setup

Before implementation, work on a feature branch:

```bash
git switch -c feat/document-header-checks
```

Run a clean baseline:

```bash
npm test
npm run validate
```

Expected: both commands pass before edits.

---

### Task 1: Preserve Header Checks In Generated Manifest Entries

**Files:**

- Modify: `scripts/lib/generated-manifest.mjs`
- Modify: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Write failing manifest preservation tests**

Add these tests near the existing generated manifest tests:

```js
test('generated manifest round-trips header checks', () => {
  const headerChecks = [
    {
      name: 'superpowers-plan-lifecycle',
      globs: ['docs/superpowers/plans/*.md'],
      headerLines: 6,
      requirePattern: '^Status: ',
      exclude: ['docs/plans/**'],
    },
  ];
  const manifest = {
    schemaVersion: 2,
    kitVersion: '0.1.9',
    templateVersion: 1,
    plugins: {
      'demo-ops': {
        pluginVersion: '0.1.0',
        playbook: 'docs/agent-playbooks/demo-ops.md',
        maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
        tasks: ['docs-review'],
        files: [],
        headerChecks,
      },
    },
  };

  const normalized = normalizeGeneratedManifest(manifest);
  assert.deepEqual(normalized.plugins['demo-ops'].headerChecks, headerChecks);

  const updated = upsertGeneratedPluginEntry(
    manifest,
    'demo-ops',
    {
      pluginVersion: '0.1.1',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [],
      headerChecks,
    },
    { kitVersion: '0.1.10', templateVersion: 1 },
  );

  assert.deepEqual(updated.plugins['demo-ops'].headerChecks, headerChecks);
});

test('generated manifest omits malformed header checks during normalization', () => {
  for (const headerChecks of [{}, 'yes', true]) {
    const normalized = normalizeGeneratedManifest({
      schemaVersion: 2,
      plugins: {
        'demo-ops': {
          pluginVersion: '0.1.0',
          playbook: 'docs/agent-playbooks/demo-ops.md',
          maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
          tasks: ['docs-review'],
          files: [],
          headerChecks,
        },
      },
    });

    assert.equal(normalized.plugins['demo-ops'].headerChecks, undefined);
  }
});

test('generated manifest carries v1 header checks forward', () => {
  const headerChecks = [
    {
      name: 'superpowers-plan-lifecycle',
      globs: ['docs/superpowers/plans/*.md'],
      headerLines: 6,
      requirePattern: '^Status: ',
    },
  ];

  const normalized = normalizeGeneratedManifest({
    schemaVersion: 1,
    pluginName: 'demo-ops',
    pluginVersion: '0.1.0',
    playbook: 'docs/agent-playbooks/demo-ops.md',
    maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
    tasks: ['docs-review'],
    files: [],
    headerChecks,
  });

  assert.deepEqual(normalized.plugins['demo-ops'].headerChecks, headerChecks);
});
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'header checks|generated manifest'
```

Expected: FAIL because `headerChecks` is not copied yet.

- [ ] **Step 3: Preserve headerChecks in generated manifest helpers**

Update `scripts/lib/generated-manifest.mjs`:

```js
function copyHeaderChecks(headerChecks) {
  if (!Array.isArray(headerChecks)) return undefined;
  return headerChecks.map((check) => ({ ...check }));
}

function copyPluginEntry(entry = {}) {
  const copied = {
    pluginVersion: entry.pluginVersion,
    playbook: entry.playbook,
    maintenanceContract: entry.maintenanceContract,
    tasks: copyTasks(entry.tasks),
    files: copyFiles(entry.files),
  };
  const playbookFirstGuidance = copyPlaybookFirstGuidance(entry.playbookFirstGuidance);
  if (playbookFirstGuidance) copied.playbookFirstGuidance = playbookFirstGuidance;
  const headerChecks = copyHeaderChecks(entry.headerChecks);
  if (headerChecks) copied.headerChecks = headerChecks;
  return copied;
}
```

The normalization helper stays lenient for non-array values so writer/upsert
paths can ignore malformed optional metadata safely. The validator will inspect
the raw generated manifest entry before normalization and report non-array
`headerChecks` as malformed user config.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'header checks|generated manifest'
```

Expected: PASS for the new preservation tests and existing generated manifest
tests.

---

### Task 2: Add Document Header Check Helper

**Files:**

- Create: `scripts/lib/document-header-checks.mjs`
- Modify: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Add failing helper tests**

Add imports near the top of `tests/trigger-layer-scripts.test.mjs`:

```js
import {
  collectDocumentHeaderCheckFailures,
  expandHeaderCheckGlobs,
  validateHeaderCheckConfig,
} from '../scripts/lib/document-header-checks.mjs';
```

Add tests near the validator tests:

```js
test('document header checks pass when a required header appears within the configured top lines', () => {
  const root = makeRoot();
  write(
    root,
    'docs/superpowers/plans/feature.md',
    `# Feature Plan
Status: Draft

Body.
`,
  );

  const failures = collectDocumentHeaderCheckFailures({
    root,
    checks: [
      {
        name: 'superpowers-plan-lifecycle',
        globs: ['docs/superpowers/plans/*.md'],
        headerLines: 6,
        requirePattern: '^Status: ',
      },
    ],
  });

  assert.deepEqual(failures, []);
});

test('document header checks fail when the header is missing from the top lines', () => {
  const root = makeRoot();
  write(
    root,
    'docs/superpowers/plans/feature.md',
    `# Feature Plan

Intro.

More intro.

Status: Draft
`,
  );

  const failures = collectDocumentHeaderCheckFailures({
    root,
    checks: [
      {
        name: 'superpowers-plan-lifecycle',
        globs: ['docs/superpowers/plans/*.md'],
        headerLines: 3,
        requirePattern: '^Status: ',
      },
    ],
  });

  assert.deepEqual(failures, [
    'MISSING header in docs/superpowers/plans/feature.md (check: superpowers-plan-lifecycle)',
  ]);
});

test('document header checks respect exclude globs', () => {
  const root = makeRoot();
  write(root, 'docs/superpowers/plans/current.md', '# Current\nStatus: Draft\n');
  write(root, 'docs/superpowers/plans/legacy.md', '# Legacy\n');

  const files = expandHeaderCheckGlobs(root, {
    globs: ['docs/superpowers/plans/*.md'],
    exclude: ['docs/superpowers/plans/legacy.md'],
  });

  assert.deepEqual(files, ['docs/superpowers/plans/current.md']);
});

test('document header glob expansion skips symlinked directories', () => {
  const root = makeRoot();
  write(root, 'docs/superpowers/plans/current.md', '# Current\nStatus: Draft\n');
  symlinkSync(root, join(root, 'docs/superpowers/plans/loop'), 'dir');

  const files = expandHeaderCheckGlobs(root, {
    globs: ['docs/superpowers/plans/**'],
  });

  assert.deepEqual(files, ['docs/superpowers/plans/current.md']);
});

test('document header checks support enum policies through requirePattern', () => {
  const root = makeRoot();
  write(root, 'docs/superpowers/specs/feature.md', '# Feature\nStatus: Banana\n');

  const failures = collectDocumentHeaderCheckFailures({
    root,
    checks: [
      {
        name: 'superpowers-status-enum',
        globs: ['docs/superpowers/specs/*.md'],
        headerLines: 6,
        requirePattern: '^Status: (Draft|Approved|Implemented)$',
      },
    ],
  });

  assert.deepEqual(failures, [
    'MISSING header in docs/superpowers/specs/feature.md (check: superpowers-status-enum)',
  ]);
});

test('document header check config reports malformed entries', () => {
  const errors = validateHeaderCheckConfig('.agent-trigger-kit/generated.json', 'demo-ops', [
    {
      name: '',
      globs: [],
      headerLines: 0,
      requirePattern: '(',
      exclude: ['docs/plans/**'],
    },
  ]);

  assert.match(errors.join('\n'), /headerChecks\[0\]\.name must be a non-empty string/);
  assert.match(errors.join('\n'), /headerChecks\[0\]\.globs must be a non-empty array/);
  assert.match(errors.join('\n'), /headerChecks\[0\]\.headerLines must be a positive integer/);
  assert.match(errors.join('\n'), /headerChecks\[0\]\.requirePattern is invalid/);
});
```

- [ ] **Step 2: Run helper tests and confirm they fail**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'document header'
```

Expected: FAIL with module-not-found or missing export errors.

- [ ] **Step 3: Create the helper module**

Create `scripts/lib/document-header-checks.mjs` with these public exports:

```js
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';

import { createPathOf } from './fs-json.mjs';

function toRelativePath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function escapeRegExp(char) {
  return char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

export function globToRegExp(glob) {
  const normalized = toRelativePath(glob);
  let source = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === '*' && next === '*') {
      const after = normalized[index + 2];
      source += after === '/' ? '(?:[^/]+/)*' : '.*';
      index += after === '/' ? 2 : 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`${source}$`);
}

function walkFiles(root) {
  const files = [];
  const pathOf = createPathOf(root);

  function visit(relativeDir) {
    const fullDir = pathOf(relativeDir || '.');
    if (!existsSync(fullDir)) return;
    for (const name of readdirSync(fullDir)) {
      if (name === '.git' || name === 'node_modules') continue;
      const relativePath = toRelativePath(relativeDir ? `${relativeDir}/${name}` : name);
      const fullPath = pathOf(relativePath);
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        visit(relativePath);
      } else if (stat.isFile()) {
        files.push(relativePath);
      }
    }
  }

  visit('');
  return files.sort();
}

export function expandHeaderCheckGlobs(root, check, files = walkFiles(root)) {
  const includePatterns = check.globs.map(globToRegExp);
  const excludePatterns = (check.exclude || []).map(globToRegExp);
  return files.filter(
    (file) =>
      includePatterns.some((pattern) => pattern.test(file)) &&
      !excludePatterns.some((pattern) => pattern.test(file)),
  );
}

export function validateHeaderCheckConfig(manifestPath, pluginName, headerChecks) {
  const errors = [];
  if (headerChecks === undefined) return errors;
  if (!Array.isArray(headerChecks)) {
    return [`${manifestPath} (${pluginName}): headerChecks must be an array when present`];
  }

  headerChecks.forEach((check, index) => {
    const prefix = `${manifestPath} (${pluginName}): headerChecks[${index}]`;
    if (!check || typeof check !== 'object' || Array.isArray(check)) {
      errors.push(`${prefix} must be an object`);
      return;
    }
    if (typeof check.name !== 'string' || check.name.trim() === '') {
      errors.push(`${prefix}.name must be a non-empty string`);
    }
    if (!Array.isArray(check.globs) || check.globs.length === 0) {
      errors.push(`${prefix}.globs must be a non-empty array`);
    } else if (check.globs.some((glob) => typeof glob !== 'string' || glob.trim() === '')) {
      errors.push(`${prefix}.globs must contain only non-empty strings`);
    }
    if (!Number.isInteger(check.headerLines) || check.headerLines <= 0) {
      errors.push(`${prefix}.headerLines must be a positive integer`);
    }
    if (typeof check.requirePattern !== 'string' || check.requirePattern.trim() === '') {
      errors.push(`${prefix}.requirePattern must be a non-empty string`);
    } else {
      try {
        new RegExp(check.requirePattern);
      } catch (error) {
        errors.push(`${prefix}.requirePattern is invalid (${error.message})`);
      }
    }
    if (
      check.exclude !== undefined &&
      (!Array.isArray(check.exclude) ||
        check.exclude.some((glob) => typeof glob !== 'string' || glob.trim() === ''))
    ) {
      errors.push(`${prefix}.exclude must be an array of non-empty strings when present`);
    }
  });

  return errors;
}

function topLines(text, count) {
  return text.replace(/\r\n?/g, '\n').split('\n').slice(0, count);
}

export function collectDocumentHeaderCheckFailures({ root, checks }) {
  const failures = [];
  const pathOf = createPathOf(root);
  const files = walkFiles(root);
  for (const check of checks || []) {
    const pattern = new RegExp(check.requirePattern);
    for (const file of expandHeaderCheckGlobs(root, check, files)) {
      const lines = topLines(readFileSync(pathOf(file), 'utf8'), check.headerLines);
      if (!lines.some((line) => pattern.test(line))) {
        failures.push(`MISSING header in ${file} (check: ${check.name})`);
      }
    }
  }
  return failures;
}
```

The helper walks the tree once per `collectDocumentHeaderCheckFailures()` call
and reuses that file list across all checks. `expandHeaderCheckGlobs()` keeps
its default walk for focused tests and direct callers.

- [ ] **Step 4: Run helper tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'document header'
```

Expected: PASS.

---

### Task 3: Wire Header Checks Into The Validator

**Files:**

- Modify: `scripts/validate-trigger-layer.mjs`
- Modify: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Add failing validator integration tests**

Add tests near the existing validator tests:

```js
test('validator treats missing headerChecks as a no-op', () => {
  const root = makeRoot();
  createPackage(root);
  const { pluginDir } = createMinimalPlugin(root);
  writeValidSkillAndCommand(root, pluginDir);
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 2,
    kitVersion: '0.1.9',
    templateVersion: 1,
    plugins: {
      'demo-ops': {
        pluginVersion: '0.1.0',
        playbook: 'docs/agent-playbooks/demo-ops.md',
        maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
        tasks: ['docs-review'],
        files: [],
      },
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('validator reports non-array headerChecks as malformed config', () => {
  const root = makeRoot();
  createPackage(root);
  const { pluginDir } = createMinimalPlugin(root);
  writeValidSkillAndCommand(root, pluginDir);
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 2,
    kitVersion: '0.1.9',
    templateVersion: 1,
    plugins: {
      'demo-ops': {
        pluginVersion: '0.1.0',
        playbook: 'docs/agent-playbooks/demo-ops.md',
        maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
        tasks: ['docs-review'],
        files: [],
        headerChecks: {},
      },
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /\.agent-trigger-kit\/generated\.json \(demo-ops\): headerChecks must be an array when present/,
  );
});

test('validator reports configured missing document headers', () => {
  const root = makeRoot();
  createPackage(root);
  const { pluginDir } = createMinimalPlugin(root);
  writeValidSkillAndCommand(root, pluginDir);
  write(root, 'docs/superpowers/plans/feature.md', '# Feature Plan\n\nBody.\n');
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 2,
    kitVersion: '0.1.9',
    templateVersion: 1,
    plugins: {
      'demo-ops': {
        pluginVersion: '0.1.0',
        playbook: 'docs/agent-playbooks/demo-ops.md',
        maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
        tasks: ['docs-review'],
        files: [],
        headerChecks: [
          {
            name: 'superpowers-plan-lifecycle',
            globs: ['docs/superpowers/plans/*.md'],
            headerLines: 6,
            requirePattern: '^Status: ',
          },
        ],
      },
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /MISSING header in docs\/superpowers\/plans\/feature\.md \(check: superpowers-plan-lifecycle\)/,
  );
});

test('validator accepts configured document headers and excludes legacy paths', () => {
  const root = makeRoot();
  createPackage(root);
  const { pluginDir } = createMinimalPlugin(root);
  writeValidSkillAndCommand(root, pluginDir);
  write(root, 'docs/superpowers/plans/feature.md', '# Feature Plan\nStatus: Draft\n');
  write(root, 'docs/plans/legacy.md', '# Legacy Plan\n');
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 2,
    kitVersion: '0.1.9',
    templateVersion: 1,
    plugins: {
      'demo-ops': {
        pluginVersion: '0.1.0',
        playbook: 'docs/agent-playbooks/demo-ops.md',
        maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
        tasks: ['docs-review'],
        files: [],
        headerChecks: [
          {
            name: 'superpowers-plan-lifecycle',
            globs: ['docs/**/*.md'],
            headerLines: 6,
            requirePattern: '^Status: ',
            exclude: ['docs/plans/**'],
          },
        ],
      },
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
```

- [ ] **Step 2: Run validator integration tests and confirm they fail**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'document headers|headerChecks'
```

Expected: FAIL because the validator is not wired to header checks yet.

- [ ] **Step 3: Import and call the helper from the validator**

Update imports in `scripts/validate-trigger-layer.mjs`:

```js
import {
  collectDocumentHeaderCheckFailures,
  validateHeaderCheckConfig,
} from './lib/document-header-checks.mjs';
```

Add:

```js
function generatedHeaderCheckEntries(generated) {
  if (!generated || typeof generated !== 'object') return [];
  if (generated.schemaVersion === 2 && generated.plugins && typeof generated.plugins === 'object') {
    return Object.entries(generated.plugins).filter(
      ([, plugin]) => plugin && typeof plugin === 'object' && !Array.isArray(plugin),
    );
  }
  if (typeof generated.pluginName === 'string' && generated.pluginName) {
    return [[generated.pluginName, generated]];
  }
  if (Array.isArray(generated.files)) {
    return [['__legacy_v1_without_plugin_name__', generated]];
  }
  return [];
}

function validateDocumentHeaderChecks() {
  const generatedPath = '.agent-trigger-kit/generated.json';
  if (!existsSync(pathOf(generatedPath))) return;

  const generated = parseJson(generatedPath);
  if (!generated) return;

  for (const [pluginName, plugin] of generatedHeaderCheckEntries(generated)) {
    const configErrors = validateHeaderCheckConfig(generatedPath, pluginName, plugin.headerChecks);
    for (const error of configErrors) fail(error);
    if (configErrors.length > 0 || !Array.isArray(plugin.headerChecks)) continue;
    for (const error of collectDocumentHeaderCheckFailures({
      root,
      checks: plugin.headerChecks,
    })) {
      fail(error);
    }
  }
}
```

The object filter is local hardening for the new header-check raw manifest pass.
Existing generated-manifest validators may still fail earlier on non-object
plugin entries; broad schema hardening for that pre-existing behavior is outside
this plan.

Call it with the other generated-manifest validation:

```js
validateMaintenanceContractPointers();
validatePlaybookFirstGuidance();
validateDocumentHeaderChecks();
validateRequiredVersionBump();
```

- [ ] **Step 4: Run validator integration tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'document headers|headerChecks'
```

Expected: PASS.

---

### Task 4: Add Init Flag And Generated Manifest Output

**Files:**

- Modify: `scripts/lib/trigger-layer.mjs`
- Modify: `scripts/init-project-trigger-layer.mjs`
- Modify: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Add failing init tests**

Add tests near the existing init tests:

```js
test('init does not write active headerChecks by default', () => {
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
  assert.equal(generatedPluginEntry(root).headerChecks, undefined);
});

test('init writes an inactive headerChecks example in the maintenance contract', () => {
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
  const maintenance = readFileSync(join(root, '.agent-trigger-kit/MAINTENANCE.md'), 'utf8');
  assert.match(maintenance, /## Optional Document Header Checks/);
  assert.match(maintenance, /"headerChecks": \[/);
  assert.equal(generatedPluginEntry(root).headerChecks, undefined);
});

test('init writes superpowers headerChecks only with explicit flag', () => {
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
    '--with-superpowers-gate',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(generatedPluginEntry(root).headerChecks, [
    {
      name: 'superpowers-plan-lifecycle',
      globs: ['docs/superpowers/specs/*.md', 'docs/superpowers/plans/*.md'],
      headerLines: 6,
      requirePattern: '^Status: ',
      exclude: ['docs/plans/**'],
    },
  ]);
});

test('init preserves existing headerChecks on re-run without the explicit flag', () => {
  const root = makeRoot();
  const first = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--with-superpowers-gate',
  ]);
  assert.equal(first.status, 0, first.stderr || first.stdout);

  const second = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--force',
  ]);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.deepEqual(generatedPluginEntry(root).headerChecks, [
    {
      name: 'superpowers-plan-lifecycle',
      globs: ['docs/superpowers/specs/*.md', 'docs/superpowers/plans/*.md'],
      headerLines: 6,
      requirePattern: '^Status: ',
      exclude: ['docs/plans/**'],
    },
  ]);
});
```

- [ ] **Step 2: Run init tests and confirm they fail**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'init .*headerChecks|superpowers headerChecks'
```

Expected: FAIL because the init flag and writer support do not exist yet.

- [ ] **Step 3: Add a shared Superpowers config constant**

In `scripts/lib/trigger-layer.mjs`, export:

```js
export const SUPERPOWERS_HEADER_CHECKS = [
  {
    name: 'superpowers-plan-lifecycle',
    globs: ['docs/superpowers/specs/*.md', 'docs/superpowers/plans/*.md'],
    headerLines: 6,
    requirePattern: '^Status: ',
    exclude: ['docs/plans/**'],
  },
];
```

- [ ] **Step 4: Teach writeTriggerLayer to carry headerChecks**

In `createWriteContext(options)`, add:

```js
const requestedHeaderChecks = options.headerChecks;
```

In `writeGeneratedManifest()`, preserve existing config unless the caller
provided new config:

```js
const previousPlugin = generatedPluginEntry(previousGeneratedManifest, pluginName);
const resolvedHeaderChecks = requestedHeaderChecks ?? previousPlugin?.headerChecks;

writeJsonFileCreatingParents(
  pathOf('.agent-trigger-kit/generated.json'),
  upsertGeneratedPluginEntry(
    previousGeneratedManifest,
    pluginName,
    {
      pluginVersion,
      playbook,
      maintenanceContract: DEFAULT_MAINTENANCE_CONTRACT,
      tasks,
      files: generatedFiles,
      ...(resolvedHeaderChecks ? { headerChecks: resolvedHeaderChecks } : {}),
      ...(playbookFirstGuidance
        ? { playbookFirstGuidance: { version: PLAYBOOK_FIRST_GUIDANCE.version } }
        : {}),
    },
    {
      kitVersion: kitPackage.version,
      templateVersion: TEMPLATE_VERSION,
    },
  ),
);
```

- [ ] **Step 5: Add the inactive maintenance-contract stub**

In `writeMaintenanceContract()`, add a short Markdown section to new
maintenance files:

````md
## Optional Document Header Checks

To opt in, copy a headerChecks block into this plugin entry in
`.agent-trigger-kit/generated.json`. Example:

```json
"headerChecks": [
  {
    "name": "superpowers-plan-lifecycle",
    "globs": ["docs/superpowers/specs/*.md", "docs/superpowers/plans/*.md"],
    "headerLines": 6,
    "requirePattern": "^Status: ",
    "exclude": ["docs/plans/**"]
  }
]
```
````

Keep this as documentation only. The validator reads the committed JSON
manifest, not this Markdown stub.

- [ ] **Step 6: Parse the init flag**

Update `scripts/init-project-trigger-layer.mjs`:

```js
import { SUPERPOWERS_HEADER_CHECKS, writeTriggerLayer } from './lib/trigger-layer.mjs';

const args = parseArgs(process.argv.slice(2), {
  booleanKeys: ['force', 'with-superpowers-gate'],
});
```

Pass the config only when requested:

```js
writeTriggerLayer({
  root,
  pluginName,
  tasks,
  playbook,
  cursorGlobs,
  taskDescriptions,
  force: Boolean(args.force),
  initialVersion: args['initial-version'] || '0.1.0',
  writePlaybookPlaceholder: true,
  playbookFirstGuidance: true,
  ...(args['with-superpowers-gate'] ? { headerChecks: SUPERPOWERS_HEADER_CHECKS } : {}),
});
```

- [ ] **Step 7: Run focused init tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'init .*headerChecks|superpowers headerChecks'
```

Expected: PASS.

---

### Task 5: Update Docs And Plugin-Visible Guidance

**Files:**

- Modify: `README.md`
- Modify: `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md`
- Modify: `plugins/agent-trigger-kit/commands/trigger-layer-init.md`
- Modify: `plugins/agent-trigger-kit/commands/trigger-layer-validate.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update README usage**

Add a section under "Use In A Project":

````md
### Optional Document Header Checks

`agent-trigger-kit validate` can enforce project-owned document header
policies from `.agent-trigger-kit/generated.json`. The feature is off when the
manifest has no `headerChecks` array.

Example plugin-entry config:

```json
"headerChecks": [
  {
    "name": "superpowers-plan-lifecycle",
    "globs": ["docs/superpowers/specs/*.md", "docs/superpowers/plans/*.md"],
    "headerLines": 6,
    "requirePattern": "^Status: ",
    "exclude": ["docs/plans/**"]
  }
]
```

Each matched file must contain a line matching `requirePattern` within the
first `headerLines` lines. Failures look like:

```text
MISSING header in docs/superpowers/plans/example.md (check: superpowers-plan-lifecycle)
```

For greenfield projects that intentionally use Superpowers spec/plan lifecycle
headers, scaffold the active config explicitly:

```bash
npx --yes github:CCC0509/agent-trigger-kit init \
  --root /path/to/project \
  --plugin <project>-ops \
  --tasks docs-review \
  --playbook docs/agent-playbooks/<project>-ops.md \
  --with-superpowers-gate
```

Agent Trigger Kit does not hard-code Superpowers status values. Projects that
want enum enforcement should express it in `requirePattern`.
````

- [ ] **Step 2: Update cross-agent skill guidance**

Add a concise bullet under required checks:

```md
- When `.agent-trigger-kit/generated.json` contains `headerChecks`, treat
  `MISSING header in <file> (check: <name>)` as a committed document lifecycle
  policy failure, not as trigger-wrapper drift.
```

- [ ] **Step 3: Update command shims**

In `trigger-layer-init.md`, add:

```md
- Use `--with-superpowers-gate` only when the project explicitly wants the
  Superpowers plan/spec status-header check committed during scaffold.
```

In `trigger-layer-validate.md`, add:

```md
- Report configured document header failures as `MISSING header in <file>
(check: <name>)`.
```

- [ ] **Step 4: Update changelog**

Add a new top entry:

```md
## 0.1.10

- Added opt-in document header checks to trigger-layer validation, configured
  from `.agent-trigger-kit/generated.json`.
- Added `init --with-superpowers-gate` to scaffold the Superpowers plan/spec
  status-header policy only when explicitly requested.
```

---

### Task 6: Version Bump And Verification

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.agents/plugins/marketplace.json`
- Modify: `plugins/agent-trigger-kit/.codex-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `plugins/agent-trigger-kit/.claude-plugin/plugin.json`

- [ ] **Step 1: Bump aligned plugin versions**

Run:

```bash
node scripts/bump-plugin-version.mjs --root . --plugin agent-trigger-kit --next patch
```

Expected: package and manifest versions move from `0.1.9` to `0.1.10`.

- [ ] **Step 2: Update package-lock root version**

Run:

```bash
npm install --package-lock-only --ignore-scripts
```

Expected: `package-lock.json` root package versions are `0.1.10`; no dependency
versions change unless npm metadata requires it.

- [ ] **Step 3: Format**

Run:

```bash
npm run format
```

Expected: Prettier completes and may format Markdown/JSON touched by this
work.

- [ ] **Step 4: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Run repository validation**

Run:

```bash
npm run validate
```

Expected: PASS.

- [ ] **Step 6: Check source version alignment**

Run:

```bash
npm run ops:plugin-version-check -- --surface source agent-trigger-kit
```

Expected: source package, Codex marketplace, Codex plugin, Claude marketplace,
and Claude plugin versions all report `0.1.10`.

- [ ] **Step 7: Review changed files**

Run:

```bash
git diff --stat
git diff -- docs/superpowers/specs/2026-05-21-document-header-checks-design.md docs/superpowers/plans/2026-05-21-document-header-checks.md
git diff -- scripts tests README.md plugins CHANGELOG.md package.json package-lock.json .agents .claude-plugin
```

Expected: changes are limited to the planned feature, docs, tests, and aligned
version files.

---

## Self-Review Checklist

- The validator is no-op when `headerChecks` is absent.
- The kit contains no Superpowers-specific validator logic.
- The Superpowers policy is data in `SUPERPOWERS_HEADER_CHECKS`, used only when
  `--with-superpowers-gate` is explicit.
- There is no `enabled` boolean.
- Failure messages exactly match `MISSING header in <file> (check: <name>)`.
- Non-array `headerChecks` in the raw generated manifest fail validation
  instead of being silently normalized away.
- The raw header-check pass skips non-object plugin entries so it does not add a
  new null dereference to the validator.
- v1 generated manifests carry valid `headerChecks` forward during
  normalization.
- Existing generated manifest config survives re-init.
- The file walker skips symlinks and walks the root once per checked plugin.
- New maintenance contracts include an inactive `headerChecks` example.
- Plugin-visible changes are paired with aligned version bumps.
- Tests cover missing header, top-line limit, exclude, regex enum, malformed
  config, default init, flag init, v1 normalization, symlink skipping, the
  inactive maintenance stub, and re-init preservation.
