# Live Trigger Surface Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only, matrix-driven live drift checker for generated trigger layers, plus static matrix validation and generated matrix documentation.

**Architecture:** Keep source version assembly reusable, then layer a consumer-owned matrix parser over existing Agent Trigger Kit probes. Static `validate` checks the matrix schema and generated docs without reading user-level agent state; `live-check` reads local Codex/Claude state and returns deterministic human/JSON drift results. Rendering is a separate write command.

**Tech Stack:** Node.js 20 ESM scripts, `node:test`, existing Agent Trigger Kit script helpers, `yaml` npm package for YAML matrix parsing, simple TOML table-name extraction for Codex config absence checks.

---

## File Structure

- Create: `scripts/lib/source-version-snapshot.mjs`
  - Owns source version discovery currently embedded in `scripts/check-plugin-version.mjs`.
- Modify: `scripts/check-plugin-version.mjs`
  - Uses `source-version-snapshot.mjs`; keeps existing CLI output and exit behavior.
- Create: `scripts/lib/live-surface-matrix.mjs`
  - Loads YAML/JSON matrices, applies defaults, validates schema/cross-field rules, evaluates staleness budgets, renders Markdown, and extracts TOML table names.
- Create: `scripts/live-trigger-surface-check.mjs`
  - Implements `live-check` and `render-matrix` modes using the matrix library and existing probes.
- Modify: `scripts/cli.mjs`
  - Adds packaged commands `live-check` and `render-matrix`.
- Modify: `scripts/validate-trigger-layer.mjs`
  - Static-checks `.agent-trigger-kit/live-surfaces.yaml` when present and verifies generated Markdown freshness.
- Create: `docs/examples/live-surfaces.yaml`
  - Template consumer matrix with no hard-coded Stock Scanner machine paths.
- Modify: `README.md`
  - Documents the live matrix workflow and command split.
- Modify: `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md`
  - Points live-discovery work at the matrix-driven commands.
- Modify: `plugins/agent-trigger-kit/skills/version-check/SKILL.md`
  - Explains when to use `version-check` vs `live-check`.
- Modify: `CHANGELOG.md`
  - Adds release notes for the live surface checker.
- Modify via npm/script: `package.json`
  - Adds `yaml` dependency and `ops:live-check` package script.
- Modify via npm: `package-lock.json`
  - Records the `yaml` dependency.
- Modify via script: package/plugin version files
  - Bump aligned Agent Trigger Kit version through existing version bump workflow.
- Create: `tests/live-trigger-surface-check.test.mjs`
  - Focused tests for source snapshot, matrix schema, static validation, renderer, live verifiers, JSON output, exit codes, and read-only behavior.
- Modify: `tests/trigger-layer-scripts.test.mjs`
  - Adds static validator coverage only if it is cleaner than testing through the new focused test file.

## Execution Setup

Start on the existing spec branch:

```bash
git status --short --branch
```

Expected branch: `spec/live-trigger-surface-checks`. Expected worktree: clean except for this plan if it is being edited.

Before implementation, fetch the latest base:

```bash
git fetch origin
```

If `origin/main` has moved, reconcile before writing runtime code:

```bash
git merge origin/main
```

---

### Task 1: Extract Source Version Snapshot Library

**Files:**

- Create: `scripts/lib/source-version-snapshot.mjs`
- Modify: `scripts/check-plugin-version.mjs`
- Test: `tests/live-trigger-surface-check.test.mjs`

- [ ] **Step 1: Add failing source snapshot tests**

Create `tests/live-trigger-surface-check.test.mjs` with the shared fixture helpers and source snapshot tests:

```js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  collectSourceVersionSnapshot,
  sourceVersionsDiffer,
} from '../scripts/lib/source-version-snapshot.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'agent-trigger-kit-live-check-test-'));
}

function write(root, path, text) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${text.trimEnd()}\n`);
}

function writeJson(root, path, value) {
  write(root, path, JSON.stringify(value, null, 2));
}

function createVersionedPlugin(root, pluginName = 'demo-ops', version = '0.1.0') {
  writeJson(root, 'package.json', {
    name: pluginName,
    version,
    private: true,
    type: 'module',
  });
  writeJson(root, '.agents/plugins/marketplace.json', {
    name: pluginName,
    plugins: [
      {
        name: pluginName,
        version,
        source: { source: 'local', path: `./plugins/${pluginName}` },
      },
    ],
  });
  writeJson(root, '.claude-plugin/marketplace.json', {
    name: pluginName,
    plugins: [
      {
        name: pluginName,
        version,
        source: `./plugins/${pluginName}`,
      },
    ],
  });
  writeJson(root, `plugins/${pluginName}/.codex-plugin/plugin.json`, {
    name: pluginName,
    version,
  });
  writeJson(root, `plugins/${pluginName}/.claude-plugin/plugin.json`, {
    name: pluginName,
    version,
  });
}

function runScript(scriptName, args, options = {}) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', scriptName), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
}

test('source snapshot collects aligned source versions', () => {
  const root = makeRoot();
  createVersionedPlugin(root, 'demo-ops', '0.2.3');

  const snapshot = collectSourceVersionSnapshot({ root, pluginName: 'demo-ops' });

  assert.equal(snapshot.pluginName, 'demo-ops');
  assert.equal(snapshot.expectedVersion, '0.2.3');
  assert.deepEqual(
    snapshot.sourceVersions.map((entry) => `${entry.label}:${entry.version}`),
    [
      'package.json:0.2.3',
      'codex marketplace:0.2.3',
      'codex plugin:0.2.3',
      'claude marketplace:0.2.3',
      'claude plugin:0.2.3',
    ],
  );
  assert.equal(sourceVersionsDiffer(snapshot), false);
});

test('source snapshot reports unaligned source versions without exiting', () => {
  const root = makeRoot();
  createVersionedPlugin(root, 'demo-ops', '0.2.3');
  const codexPluginPath = join(root, 'plugins/demo-ops/.codex-plugin/plugin.json');
  const codexPlugin = JSON.parse(readFileSync(codexPluginPath, 'utf8'));
  codexPlugin.version = '0.2.2';
  writeJson(root, 'plugins/demo-ops/.codex-plugin/plugin.json', codexPlugin);

  const snapshot = collectSourceVersionSnapshot({ root, pluginName: 'demo-ops' });

  assert.equal(sourceVersionsDiffer(snapshot), true);
  assert.match(snapshot.errorMessage, /source versions differ/);
  assert.match(snapshot.errorMessage, /codex plugin=0.2.2/);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

```bash
node --test tests/live-trigger-surface-check.test.mjs --test-name-pattern 'source snapshot'
```

Expected: FAIL with module-not-found for `scripts/lib/source-version-snapshot.mjs`.

- [ ] **Step 3: Create `scripts/lib/source-version-snapshot.mjs`**

```js
import { normalize } from 'node:path';

import { createPathOf, readJsonFileIfExistsOrExit } from './fs-json.mjs';

function sourceEntry(label, version) {
  return { label, version: version || 'missing' };
}

function packageNameMatchesPlugin(packageName, pluginName) {
  return packageName === pluginName || packageName?.endsWith(`/${pluginName}`);
}

function shouldIncludePackage({ packageJson, pluginName, includePackage, noIncludePackage }) {
  if (includePackage) return true;
  if (noIncludePackage) return false;
  return packageNameMatchesPlugin(packageJson?.name, pluginName);
}

export function collectSourceVersionSnapshot({
  root,
  pluginName,
  includePackage = false,
  noIncludePackage = false,
}) {
  const normalizedRoot = normalize(root || process.cwd());
  const pathOf = createPathOf(normalizedRoot);
  const packageJson = readJsonFileIfExistsOrExit(pathOf('package.json'), null);
  const codexMarketplace = readJsonFileIfExistsOrExit(
    pathOf('.agents/plugins/marketplace.json'),
    null,
  );
  const claudeMarketplace = readJsonFileIfExistsOrExit(
    pathOf('.claude-plugin/marketplace.json'),
    null,
  );
  const codexEntry = codexMarketplace?.plugins?.find((entry) => entry.name === pluginName);
  const claudeEntry = claudeMarketplace?.plugins?.find((entry) => entry.name === pluginName);
  const pluginDir =
    codexEntry?.source?.path?.replace(/^\.\//, '') || claudeEntry?.source?.replace(/^\.\//, '');

  if (!pluginDir) {
    return {
      pluginName,
      sourceVersions: [],
      expectedVersion: 'missing',
      pluginDir: null,
      marketplaceName: codexMarketplace?.name || pluginName,
      claudeMarketplaceName: claudeMarketplace?.name || codexMarketplace?.name || pluginName,
      errorMessage: `${pluginName}: missing plugin source in marketplace manifests`,
    };
  }

  const codexPlugin = readJsonFileIfExistsOrExit(
    pathOf(`${pluginDir}/.codex-plugin/plugin.json`),
    null,
  );
  const claudePlugin = readJsonFileIfExistsOrExit(
    pathOf(`${pluginDir}/.claude-plugin/plugin.json`),
    null,
  );
  const sourceVersions = [
    ...(shouldIncludePackage({ packageJson, pluginName, includePackage, noIncludePackage })
      ? [sourceEntry('package.json', packageJson?.version)]
      : []),
    sourceEntry('codex marketplace', codexEntry?.version),
    sourceEntry('codex plugin', codexPlugin?.version),
    sourceEntry('claude marketplace', claudeEntry?.version),
    sourceEntry('claude plugin', claudePlugin?.version),
  ];
  const uniqueVersions = new Set(sourceVersions.map((entry) => entry.version));
  const errorMessage =
    uniqueVersions.size === 1
      ? null
      : `source versions differ: ${sourceVersions
          .map((entry) => `${entry.label}=${entry.version}`)
          .join(', ')}`;

  return {
    pluginName,
    sourceVersions,
    expectedVersion: sourceVersions[0]?.version || 'missing',
    pluginDir,
    marketplaceName: codexMarketplace?.name || pluginName,
    claudeMarketplaceName: claudeMarketplace?.name || codexMarketplace?.name || pluginName,
    errorMessage,
  };
}

export function sourceVersionsDiffer(snapshot) {
  return Boolean(snapshot.errorMessage);
}
```

- [ ] **Step 4: Refactor `scripts/check-plugin-version.mjs` to use the library**

Replace local `sourceEntry()`, `packageNameMatchesPlugin()`, `shouldIncludePackage()`, source marketplace parsing, plugin-dir derivation, and `uniqueVersions` logic with:

```js
import {
  collectSourceVersionSnapshot,
  sourceVersionsDiffer,
} from './lib/source-version-snapshot.mjs';
```

Then build the source snapshot after argument validation:

```js
const sourceSnapshot = collectSourceVersionSnapshot({
  root,
  pluginName,
  includePackage: Boolean(args['include-package']),
  noIncludePackage: Boolean(args['no-include-package']),
});

if (sourceVersionsDiffer(sourceSnapshot)) {
  console.error(sourceSnapshot.errorMessage);
  process.exit(1);
}

const { sourceVersions, expectedVersion, pluginDir, marketplaceName } = sourceSnapshot;
const claudeMarketplaceName = sourceSnapshot.claudeMarketplaceName;
```

Keep all existing human and JSON output labels unchanged.

- [ ] **Step 5: Verify source snapshot and existing version-check behavior**

```bash
node --test tests/live-trigger-surface-check.test.mjs --test-name-pattern 'source snapshot'
npm run ops:plugin-version-check -- --surface source agent-trigger-kit
npm run ops:plugin-version-check -- --surface source --json agent-trigger-kit
```

Expected: source snapshot tests PASS; human command reports aligned source versions; JSON command prints `expectedVersion` equal to the current package version.

- [ ] **Step 6: Commit Task 1**

```bash
git add scripts/lib/source-version-snapshot.mjs scripts/check-plugin-version.mjs tests/live-trigger-surface-check.test.mjs
git commit -m "refactor: extract source version snapshot"
```

---

### Task 2: Add Matrix Parser, Schema Validation, And Markdown Renderer

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/lib/live-surface-matrix.mjs`
- Modify: `tests/live-trigger-surface-check.test.mjs`
- Create: `docs/examples/live-surfaces.yaml`

- [ ] **Step 1: Add the YAML dependency**

```bash
npm install yaml --save
```

Expected: `package.json` gains a `dependencies.yaml` entry and `package-lock.json` records the installed version.

- [ ] **Step 2: Add failing matrix parser tests**

Append to `tests/live-trigger-surface-check.test.mjs`:

```js
import {
  extractTomlTableNames,
  loadLiveSurfaceMatrix,
  renderLiveSurfaceMarkdown,
  validateLiveSurfaceMatrix,
} from '../scripts/lib/live-surface-matrix.mjs';

function writeLiveMatrix(root, text) {
  write(root, '.agent-trigger-kit/live-surfaces.yaml', text);
}

test('live surface matrix validates schema and applies path defaults', () => {
  const root = makeRoot();
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
generatedDocs:
  markdownTable: docs/agent-trigger-surfaces.md
defaults:
  timeoutMs: 12345
surfaces:
  - id: codex-demo
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
  - id: claude-demo
    surface: claude
    scope: project
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: project-plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: claude-installed-plugin
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
assertions:
  - id: no-component-collisions
    kind: component-name-disjoint
    plugin: demo-ops
    sets: [skills, commands]
    onFailure: drift
    owner: demo
extraFutureField: preserved
`,
  );

  const matrix = loadLiveSurfaceMatrix({ root, matrixPath: '.agent-trigger-kit/live-surfaces.yaml' });
  const validation = validateLiveSurfaceMatrix({ root, matrix });

  assert.deepEqual(validation.errors, []);
  assert.equal(matrix.surfaces[0].timeoutMs, 12345);
  assert.equal(matrix.surfaces[0].liveVerifier.codexHome.endsWith('.codex'), true);
  assert.equal(matrix.surfaces[1].liveVerifier.claudeHome.endsWith('.claude'), true);
  assert.equal(matrix.surfaces[1].liveVerifier.projectPath, root);
  assert.equal(matrix.extraFutureField, 'preserved');
});

test('live surface matrix rejects invalid assertion onFailure and pointer-only misuse', () => {
  const root = makeRoot();
  const matrix = {
    schemaVersion: 1,
    plugin: 'demo-ops',
    surfaces: [
      {
        id: 'bad-pointer-budget',
        surface: 'codex',
        scope: 'user',
        plugin: 'demo-ops',
        artifactType: 'plugin-cache',
        sourceTruth: 'source-version',
        liveVerifier: { kind: 'codex-cache' },
        headless: 'safe',
        owner: 'demo',
        stalenessBudget: { mode: 'pointer-only', reason: 'not a pointer', until: '2026-06-30' },
      },
    ],
    assertions: [
      {
        id: 'bad-assertion',
        kind: 'component-name-disjoint',
        plugin: 'demo-ops',
        sets: ['skills', 'commands'],
        onFailure: 'clean',
        owner: 'demo',
      },
    ],
  };

  const validation = validateLiveSurfaceMatrix({ root, matrix });

  assert.match(validation.errors.join('\n'), /pointer-only/);
  assert.match(validation.errors.join('\n'), /onFailure/);
});

test('live surface matrix renders markdown and extracts codex config table names', () => {
  const markdown = renderLiveSurfaceMarkdown({
    schemaVersion: 1,
    plugin: 'demo-ops',
    surfaces: [
      {
        id: 'codex-demo',
        surface: 'codex',
        scope: 'user',
        plugin: 'demo-ops',
        artifactType: 'plugin-cache',
        sourceTruth: 'source-version',
        liveVerifier: { kind: 'codex-cache' },
        headless: 'safe',
        owner: 'demo',
        stalenessBudget: { mode: 'none' },
      },
    ],
    assertions: [],
  });

  assert.match(markdown, /\| Surface \| Scope \| Artifact \| Source Truth \| Live Verifier \| Headless \| Owner \| Staleness Budget \|/);
  assert.match(markdown, /\| codex \| user \| plugin-cache \| source-version \| codex-cache \| safe \| demo \| none \|/);

  const tables = extractTomlTableNames(`
[marketplaces.stock-scanner-ops]
source = "/Users/example/projects/stock-scanner"

[plugins."stock-scanner-ops@stock-scanner-ops"]
enabled = true
`);

  assert.deepEqual(tables.plugins, ['stock-scanner-ops@stock-scanner-ops']);
  assert.deepEqual(tables.marketplaces, ['stock-scanner-ops']);
});
```

- [ ] **Step 3: Run focused tests and confirm they fail**

```bash
node --test tests/live-trigger-surface-check.test.mjs --test-name-pattern 'live surface matrix'
```

Expected: FAIL with module-not-found for `scripts/lib/live-surface-matrix.mjs`.

- [ ] **Step 4: Create `scripts/lib/live-surface-matrix.mjs`**

Implement the public API with these exported functions:

```js
export function loadLiveSurfaceMatrix({ root, matrixPath = '.agent-trigger-kit/live-surfaces.yaml' }) {}
export function validateLiveSurfaceMatrix({ root, matrix }) {}
export function renderLiveSurfaceMarkdown(matrix) {}
export function extractTomlTableNames(text) {}
export function effectiveTimeoutMs({ rowTimeoutMs, cliTimeoutMs, defaultTimeoutMs, envTimeoutMs }) {}
```

Implementation requirements:

- Parse `.json` with `JSON.parse`.
- Parse `.yaml` / `.yml` with `yaml.parse`.
- Expand `${VAR}`, `${VAR:-fallback}`, `~`, and `${ROOT}` in path fields.
- Default `codexHome` to `${CODEX_HOME:-~/.codex}`.
- Default `claudeHome` to `${CLAUDE_HOME:-~/.claude}`.
- Default `claude-installed-plugin.projectPath` to resolved `root` for `scope: project`.
- Keep unknown fields on the parsed matrix object.
- Validate required surface fields exactly as the spec lists them.
- Validate required assertion fields and `component-name-disjoint` fields.
- Validate `onFailure` is only `drift` or `allowed-drift`.
- Validate `pointer-only` only appears with `artifactType: pointer-doc` and `liveVerifier.kind: pointer-doc`.
- Validate duplicate surface/assertion IDs.
- Validate known verifier kinds.
- Render Markdown deterministically with the spec's table columns.
- Extract TOML table names using anchored table-header regexes:

```js
const tablePattern = /^\s*\[([^\]]+)\]\s*$/gm;
```

For quoted plugin table names, remove one level of surrounding double quotes from the key after `plugins.`.

- [ ] **Step 5: Add `docs/examples/live-surfaces.yaml`**

Create a template matching the spec example, but keep home paths and `projectPath` omitted:

```yaml
schemaVersion: 1
plugin: demo-ops
canonicalPlaybook: docs/agent-playbooks/demo-ops.md
generatedManifest: .agent-trigger-kit/generated.json
generatedDocs:
  markdownTable: docs/agent-trigger-surfaces.md
defaults:
  timeoutMs: 20000
surfaces:
  - id: codex-demo-ops
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
  - id: claude-project-demo-ops
    surface: claude
    scope: project
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: project-plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: claude-installed-plugin
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
assertions:
  - id: no-skill-command-name-collisions
    kind: component-name-disjoint
    plugin: demo-ops
    sets:
      - skills
      - commands
    onFailure: drift
    owner: demo
```

- [ ] **Step 6: Verify matrix parser tests**

```bash
node --test tests/live-trigger-surface-check.test.mjs --test-name-pattern 'live surface matrix'
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add package.json package-lock.json scripts/lib/live-surface-matrix.mjs tests/live-trigger-surface-check.test.mjs docs/examples/live-surfaces.yaml
git commit -m "feat: add live surface matrix parser"
```

---

### Task 3: Integrate Static Matrix Validation And Render Command

**Files:**

- Modify: `scripts/validate-trigger-layer.mjs`
- Create or modify: `scripts/live-trigger-surface-check.mjs`
- Modify: `scripts/cli.mjs`
- Modify: `tests/live-trigger-surface-check.test.mjs`

- [ ] **Step 1: Add failing tests for static validation and render command**

Append tests:

```js
test('validate checks live surface matrix schema and generated markdown freshness', () => {
  const root = makeRoot();
  createVersionedPlugin(root, 'demo-ops', '0.1.0');
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
generatedDocs:
  markdownTable: docs/agent-trigger-surfaces.md
surfaces:
  - id: codex-demo
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );
  write(root, 'docs/agent-trigger-surfaces.md', '| stale | table |');

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /docs\/agent-trigger-surfaces.md: generated Markdown is stale/);
});

test('render-matrix writes generated Markdown from matrix', () => {
  const root = makeRoot();
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
generatedDocs:
  markdownTable: docs/agent-trigger-surfaces.md
surfaces:
  - id: codex-demo
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', [
    'render-matrix',
    '--root',
    root,
    '--matrix',
    '.agent-trigger-kit/live-surfaces.yaml',
    '--output',
    'docs/agent-trigger-surfaces.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(readFileSync(join(root, 'docs/agent-trigger-surfaces.md'), 'utf8'), /\| codex \| user \|/);
});
```

- [ ] **Step 2: Run focused tests and confirm they fail**

```bash
node --test tests/live-trigger-surface-check.test.mjs --test-name-pattern 'validate checks|render-matrix'
```

Expected: FAIL because validator/render command are not integrated.

- [ ] **Step 3: Update `scripts/validate-trigger-layer.mjs`**

Import matrix helpers:

```js
import {
  loadLiveSurfaceMatrix,
  renderLiveSurfaceMarkdown,
  validateLiveSurfaceMatrix,
} from './lib/live-surface-matrix.mjs';
```

After existing generated-manifest/document-header validation setup, add:

```js
function validateLiveSurfaceMatrixIfPresent() {
  const matrixPath = '.agent-trigger-kit/live-surfaces.yaml';
  if (!existsSync(pathOf(matrixPath))) return;

  const matrix = loadLiveSurfaceMatrix({ root, matrixPath });
  const validation = validateLiveSurfaceMatrix({ root, matrix });
  for (const error of validation.errors) {
    fail(`${matrixPath}: ${error}`);
  }

  const markdownPath = matrix.generatedDocs?.markdownTable;
  if (markdownPath) {
    const expected = renderLiveSurfaceMarkdown(matrix);
    const actual = existsSync(pathOf(markdownPath)) ? read(markdownPath) : '';
    if (actual !== expected) {
      fail(`${markdownPath}: generated Markdown is stale; run agent-trigger-kit render-matrix`);
    }
  }
}
```

Call `validateLiveSurfaceMatrixIfPresent()` before final failure reporting.

- [ ] **Step 4: Add `render-matrix` mode and CLI wiring**

In `scripts/live-trigger-surface-check.mjs`, support the first positional command `render-matrix`:

```js
const [mode, ...rest] = process.argv.slice(2);
if (mode === 'render-matrix') {
  const args = parseArgs(rest);
  const root = normalize(args.root || process.cwd());
  const matrixPath = args.matrix || '.agent-trigger-kit/live-surfaces.yaml';
  const output = args.output;
  if (!output) {
    console.error('render-matrix requires --output');
    process.exit(2);
  }
  const matrix = loadLiveSurfaceMatrix({ root, matrixPath });
  const validation = validateLiveSurfaceMatrix({ root, matrix });
  if (validation.errors.length > 0) {
    console.error(validation.errors.join('\n'));
    process.exit(3);
  }
  writeFileSync(join(root, output), renderLiveSurfaceMarkdown(matrix));
  console.log(`wrote ${output}`);
  process.exit(0);
}
```

In `scripts/cli.mjs`, add:

```js
'live-check': 'live-trigger-surface-check.mjs',
'render-matrix': 'live-trigger-surface-check.mjs',
```

For `render-matrix`, pass a leading `render-matrix` argument when dispatching:

```js
const dispatchArgs =
  command === 'render-matrix' ? [join(scriptDir, scriptName), 'render-matrix', ...commandArgs] : [join(scriptDir, scriptName), ...commandArgs];
```

- [ ] **Step 5: Verify static validation/render tests**

```bash
node --test tests/live-trigger-surface-check.test.mjs --test-name-pattern 'validate checks|render-matrix'
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add scripts/validate-trigger-layer.mjs scripts/live-trigger-surface-check.mjs scripts/cli.mjs tests/live-trigger-surface-check.test.mjs
git commit -m "feat: validate and render live surface matrices"
```

---

### Task 4: Implement Live-Check Verifiers And Exit Codes

**Files:**

- Modify: `scripts/live-trigger-surface-check.mjs`
- Modify: `tests/live-trigger-surface-check.test.mjs`

- [ ] **Step 1: Add failing live-check tests**

Append tests for the core verifiers:

```js
function writeCodexCache(root, marketplaceName, pluginName, version) {
  write(root, `.codex/plugins/cache/${marketplaceName}/${pluginName}/${version}/skills/demo/SKILL.md`, '# Demo');
}

function writeClaudeInstalled(root, pluginId, entry) {
  writeJson(root, '.claude/plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      [pluginId]: [entry],
    },
  });
  write(root, `${entry.installPath.replace(`${root}/`, '')}/skills/demo/SKILL.md`, '# Demo');
}

test('live-check reports drift, allowed drift, and clean rows without mutating state', () => {
  const root = makeRoot();
  createVersionedPlugin(root, 'demo-ops', '0.1.0');
  writeCodexCache(root, 'demo-ops', 'demo-ops', '0.1.0');
  const installPath = join(root, '.claude/plugins/cache/demo-ops/demo-ops/0.0.9');
  writeClaudeInstalled(root, 'demo-ops@demo-ops', {
    scope: 'project',
    projectPath: root,
    version: '0.0.9',
    installPath,
  });
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: codex-demo
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
      codexHome: "\${ROOT}/.codex"
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
  - id: claude-demo
    surface: claude
    scope: project
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: project-plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: claude-installed-plugin
      claudeHome: "\${ROOT}/.claude"
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', [
    '--root',
    root,
    '--json',
  ]);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(payload.summary.clean, 1);
  assert.equal(payload.summary.drift, 1);
  assert.equal(payload.results.find((row) => row.id === 'codex-demo').status, 'clean');
  assert.equal(payload.results.find((row) => row.id === 'claude-demo').status, 'drift');
  assert.match(payload.results.find((row) => row.id === 'claude-demo').nextActions.join('\n'), /claude plugin update/);
});

test('live-check flags codex forbidden config residue by exact table names', () => {
  const root = makeRoot();
  createVersionedPlugin(root, 'demo-ops', '0.1.0');
  write(
    root,
    '.codex/config.toml',
    `
[marketplaces.demo-ops]
source = "/tmp/demo"

[plugins."demo-ops@demo-ops"]
enabled = true
`,
  );
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: no-global-demo
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: negative-config-assertion
    sourceTruth: allowlist
    liveVerifier:
      kind: codex-config-absence
      configPath: "\${ROOT}/.codex/config.toml"
      forbiddenPluginIds: [demo-ops@demo-ops]
      forbiddenMarketplaces: [demo-ops]
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(payload.results[0].status, 'drift');
  assert.match(payload.results[0].message, /demo-ops@demo-ops/);
});

test('live-check exits zero when filters select no rows', () => {
  const root = makeRoot();
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces: []
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--owner', 'nobody']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /no rows selected/);
});
```

- [ ] **Step 2: Run focused tests and confirm they fail**

```bash
node --test tests/live-trigger-surface-check.test.mjs --test-name-pattern 'live-check'
```

Expected: FAIL because live-check mode is not implemented.

- [ ] **Step 3: Implement result helpers and exit-code precedence**

In `scripts/live-trigger-surface-check.mjs`, add helpers:

```js
const EXIT_PRECEDENCE = {
  timeout: 124,
  configError: 3,
  validationError: 2,
  drift: 1,
  clean: 0,
};

function exitCodeForResults(results) {
  if (results.some((result) => result.status === 'timeout')) return 124;
  if (results.some((result) => result.status === 'config-error')) return 3;
  if (results.some((result) => result.status === 'validation-error')) return 2;
  if (results.some((result) => result.status === 'drift')) return 1;
  return 0;
}

function summarize(results) {
  return {
    clean: results.filter((result) => result.status === 'clean').length,
    drift: results.filter((result) => result.status === 'drift').length,
    allowedDrift: results.filter((result) => result.status === 'allowed-drift').length,
    validationErrors: results.filter((result) => result.status === 'validation-error').length,
    timeouts: results.filter((result) => result.status === 'timeout').length,
  };
}
```

- [ ] **Step 4: Implement verifiers**

Use existing probes:

```js
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';

import { probeClaudeState, probeCodexCache } from './lib/plugin-state-probe.mjs';
import { collectSourceVersionSnapshot } from './lib/source-version-snapshot.mjs';
import {
  extractTomlTableNames,
  loadLiveSurfaceMatrix,
  validateLiveSurfaceMatrix,
} from './lib/live-surface-matrix.mjs';
```

Verifier behavior:

- `codex-cache`: `probeCodexCache({ codexHome, marketplaceName, pluginName, expectedVersion })`; drift when expected version is missing.
- `claude-installed-plugin`: `probeClaudeState({ claudeHome, envPath: '', expectedVersion, marketplaceName, pluginName })`; never call Claude CLI; drift when no entry has matching version/scope/projectPath.
- `codex-config-absence`: if config missing, clean; else use `extractTomlTableNames()` and exact-match forbidden plugin/marketplace tables.
- `pointer-doc`: read target pointer doc path from row `path` if present, otherwise `GEMINI.md` for `surface: gemini`; require frontmatter `pointer_only: true`.
- `static-validator`: return clean in live-check; static failure is owned by `validate`.
- `component-name-disjoint`: read plugin manifest skill/command directories, compare basenames/frontmatter names, and return row status based on `onFailure`.

Apply staleness budgets after a verifier returns drift:

```js
function applyStalenessBudget(result, budget, now = new Date()) {
  if (result.status !== 'drift') return result;
  if (budget?.mode === 'allowed-until' || budget?.mode === 'pointer-only') {
    const until = new Date(`${budget.until}T23:59:59Z`);
    if (!Number.isNaN(until.valueOf()) && now <= until) {
      return { ...result, status: 'allowed-drift', allowedReason: budget.reason || budget.mode };
    }
  }
  return result;
}
```

- [ ] **Step 5: Implement human and JSON output**

Human output must include row ID, surface/scope, status, and owner summary. JSON output must include stable fields:

```js
{
  schemaVersion: 1,
  plugin: matrix.plugin,
  status: exitCode === 0 ? 'clean' : exitCode === 1 ? 'drift' : 'error',
  summary,
  results,
}
```

`nextActions` are strings only; the script must not execute them.

- [ ] **Step 6: Verify live-check tests**

```bash
node --test tests/live-trigger-surface-check.test.mjs --test-name-pattern 'live-check'
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add scripts/live-trigger-surface-check.mjs tests/live-trigger-surface-check.test.mjs
git commit -m "feat: add live trigger surface check"
```

---

### Task 5: Update Docs, Skills, CLI Help, And Version Metadata

**Files:**

- Modify: `scripts/cli.mjs`
- Modify: `README.md`
- Modify: `plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md`
- Modify: `plugins/agent-trigger-kit/skills/version-check/SKILL.md`
- Modify: `CHANGELOG.md`
- Modify via script: `package.json`
- Modify via script: `.agents/plugins/marketplace.json`
- Modify via script: `plugins/agent-trigger-kit/.codex-plugin/plugin.json`
- Modify via script: `.claude-plugin/marketplace.json`
- Modify via script: `plugins/agent-trigger-kit/.claude-plugin/plugin.json`
- Test: `tests/trigger-layer-scripts.test.mjs` or `tests/live-trigger-surface-check.test.mjs`

- [ ] **Step 1: Update CLI help**

In `scripts/cli.mjs`, add help lines:

```js
'  live-check     Check live agent trigger surfaces from a consumer-owned matrix',
'  render-matrix  Render live trigger surface matrix documentation',
```

- [ ] **Step 2: Add docs regression assertions**

Add a focused test that reads README and skill files:

```js
test('live trigger surface docs explain matrix ownership and read-only checks', () => {
  const readRepoFile = (path) => readFileSync(join(repoRoot, path), 'utf8');
  const readme = readRepoFile('README.md');
  const crossSkill = readRepoFile('plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md');
  const versionSkill = readRepoFile('plugins/agent-trigger-kit/skills/version-check/SKILL.md');

  assert.match(readme, /live-surfaces\.yaml/);
  assert.match(readme, /agent-trigger-kit live-check/);
  assert.match(readme, /agent-trigger-kit render-matrix/);
  assert.match(readme, /read-only by default/i);

  assert.match(crossSkill, /live-check/);
  assert.match(crossSkill, /consumer-owned matrix/i);
  assert.match(crossSkill, /Codex.*global.*residue/i);

  assert.match(versionSkill, /version-check[\s\S]*source/);
  assert.match(versionSkill, /live-check[\s\S]*installed-state drift/);
});
```

- [ ] **Step 3: Update README and skills**

Add a README section after the consumer lifecycle static gate:

```markdown
### Live Trigger Surface Checks

Consumers own `.agent-trigger-kit/live-surfaces.yaml`. Agent Trigger Kit owns the
schema, parser, static validator, and live-check command. Run static checks in
CI, then run live-check as an operator/release gate on the machine whose agent
state matters:

```bash
CONSUMER_ROOT=/path/to/consumer-repo
PLUGIN_NAME=demo-ops
agent-trigger-kit validate --root "$CONSUMER_ROOT"
agent-trigger-kit live-check --root "$CONSUMER_ROOT" --plugin "$PLUGIN_NAME"
agent-trigger-kit render-matrix --root "$CONSUMER_ROOT" --output docs/agent-trigger-surfaces.md
```

`live-check` is read-only by default. It may print manual `nextActions`, but it
does not update Codex or Claude state unless a future explicit repair mode is
implemented and invoked.
```
```

Update the cross-agent and version-check skills with the same routing rule in shorter form.

- [ ] **Step 4: Bump version and changelog**

Run:

```bash
node scripts/bump-plugin-version.mjs --root . --plugin agent-trigger-kit --next patch
npm install
NEW_VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")
```

Then update `CHANGELOG.md` with the new version heading:

```markdown
## ${NEW_VERSION}

- Added matrix-driven live trigger surface checks for consumer repositories,
  including read-only Codex/Claude drift probes, generated matrix docs, and
  static matrix validation.
```

Use the literal version printed by `NEW_VERSION`; do not commit `${NEW_VERSION}`
as text in `CHANGELOG.md`.

- [ ] **Step 5: Verify docs and source version alignment**

```bash
node --test tests/live-trigger-surface-check.test.mjs --test-name-pattern 'docs explain|live surface'
npm run ops:plugin-version-check -- --surface source agent-trigger-kit
```

Expected: tests PASS and all source versions match the new version.

- [ ] **Step 6: Commit Task 5**

```bash
git add README.md CHANGELOG.md package.json package-lock.json .agents/plugins/marketplace.json .claude-plugin/marketplace.json plugins/agent-trigger-kit/.codex-plugin/plugin.json plugins/agent-trigger-kit/.claude-plugin/plugin.json plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md plugins/agent-trigger-kit/skills/version-check/SKILL.md scripts/cli.mjs tests/live-trigger-surface-check.test.mjs
git commit -m "docs: document live trigger surface checks"
```

---

### Task 6: Final Verification And Branch Readiness

**Files:**

- Verify only unless failures require fixes.

- [ ] **Step 1: Run focused live-check test suite**

```bash
node --test tests/live-trigger-surface-check.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run existing trigger-layer tests**

```bash
node --test tests/trigger-layer-scripts.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run full project test suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run static validator**

```bash
npm run validate
```

Expected: `trigger layer validation passed`.

- [ ] **Step 5: Run source version and pre-merge checks**

```bash
npm run ops:plugin-version-check -- --surface source agent-trigger-kit
npm run ops:premerge-version-check -- --base origin/main
```

Expected: both PASS. If `ops:premerge-version-check` reports base reconciliation failure, run `git fetch origin` and merge/rebase the branch before rerunning.

- [ ] **Step 6: Verify packaged CLI commands**

```bash
npm exec --cache /private/tmp/agent-trigger-kit-npm-cache --yes --package . -- agent-trigger-kit --help
npm exec --cache /private/tmp/agent-trigger-kit-npm-cache --yes --package . -- agent-trigger-kit live-check --help
npm pack --cache /private/tmp/agent-trigger-kit-npm-cache --dry-run --json
```

Expected: help lists `live-check` and `render-matrix`; pack dry-run includes scripts, plugin files, docs examples, and tests expected for this package.

- [ ] **Step 7: Commit any final verification fixes**

If verification required fixes, commit them:

```bash
git status --short
git add scripts/live-trigger-surface-check.mjs tests/live-trigger-surface-check.test.mjs scripts/lib/live-surface-matrix.mjs
git commit -m "fix: stabilize live trigger surface checks"
```

If no fixes were needed, do not create an empty commit.

- [ ] **Step 8: Prepare review summary**

Collect:

```bash
git log --oneline origin/main..HEAD
git status --short
```

Expected: branch contains the implementation commits and working tree is clean.
