import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
  return mkdtempSync(join(tmpdir(), 'agent-trigger-kit-live-trigger-surface-'));
}

function write(root, path, text) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${text.trimEnd()}\n`);
}

function writeJson(root, path, value) {
  write(root, path, JSON.stringify(value, null, 2));
}

function createVersionedPlugin(root, version = '0.2.3') {
  const pluginName = 'demo-ops';
  const pluginDir = `plugins/${pluginName}`;

  writeJson(root, 'package.json', {
    name: pluginName,
    version,
    type: 'module',
  });
  writeJson(root, '.agents/plugins/marketplace.json', {
    name: pluginName,
    plugins: [
      {
        name: pluginName,
        version,
        source: { source: 'local', path: `./${pluginDir}` },
      },
    ],
  });
  writeJson(root, '.claude-plugin/marketplace.json', {
    name: pluginName,
    plugins: [
      {
        name: pluginName,
        version,
        source: `./${pluginDir}`,
      },
    ],
  });
  writeJson(root, `${pluginDir}/.codex-plugin/plugin.json`, {
    name: pluginName,
    version,
  });
  writeJson(root, `${pluginDir}/.claude-plugin/plugin.json`, {
    name: pluginName,
    version,
  });

  return { pluginDir, pluginName, version };
}

function runScript(scriptName, args, options = {}) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', scriptName), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
}

test('source snapshot reports aligned source versions', () => {
  const root = makeRoot();
  const { pluginDir, pluginName, version } = createVersionedPlugin(root, '0.2.3');

  const snapshot = collectSourceVersionSnapshot({ root, pluginName });

  assert.equal(snapshot.pluginName, pluginName);
  assert.equal(snapshot.expectedVersion, version);
  assert.equal(snapshot.pluginDir, pluginDir);
  assert.deepEqual(snapshot.sourceVersions, [
    { label: 'package.json', version: '0.2.3' },
    { label: 'codex marketplace', version: '0.2.3' },
    { label: 'codex plugin', version: '0.2.3' },
    { label: 'claude marketplace', version: '0.2.3' },
    { label: 'claude plugin', version: '0.2.3' },
  ]);
  assert.equal(sourceVersionsDiffer(snapshot), false);

  const result = runScript('check-plugin-version.mjs', [
    '--root',
    root,
    '--surface',
    'source',
    pluginName,
  ]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /expected source version: 0\.2\.3/);
});

test('source snapshot defaults omitted root to the current working directory', () => {
  const root = makeRoot();
  const { pluginDir, pluginName, version } = createVersionedPlugin(root, '0.2.3');
  const previousCwd = process.cwd();

  try {
    process.chdir(root);

    const snapshot = collectSourceVersionSnapshot({ pluginName });

    assert.equal(snapshot.pluginName, pluginName);
    assert.equal(snapshot.expectedVersion, version);
    assert.equal(snapshot.pluginDir, pluginDir);
    assert.equal(sourceVersionsDiffer(snapshot), false);
  } finally {
    process.chdir(previousCwd);
  }
});

test('source snapshot reports malformed JSON without exiting', () => {
  const root = makeRoot();
  const { pluginName } = createVersionedPlugin(root, '0.2.3');
  write(root, 'package.json', '{');
  const previousExit = process.exit;

  try {
    process.exit = (code) => {
      throw new Error(`process.exit(${code})`);
    };

    const snapshot = collectSourceVersionSnapshot({ root, pluginName });

    assert.equal(snapshot.pluginName, pluginName);
    assert.deepEqual(snapshot.sourceVersions, []);
    assert.equal(snapshot.expectedVersion, 'missing');
    assert.equal(snapshot.pluginDir, null);
    assert.equal(snapshot.marketplaceName, pluginName);
    assert.equal(snapshot.claudeMarketplaceName, pluginName);
    assert.match(snapshot.errorMessage, /package\.json/);
    assert.match(snapshot.errorMessage, /Expected property name|JSON/);
    assert.equal(sourceVersionsDiffer(snapshot), true);
  } finally {
    process.exit = previousExit;
  }
});

test('source snapshot reports unaligned source versions', () => {
  const root = makeRoot();
  const { pluginDir, pluginName } = createVersionedPlugin(root, '0.2.3');
  writeJson(root, `${pluginDir}/.codex-plugin/plugin.json`, {
    name: pluginName,
    version: '0.2.2',
  });

  const snapshot = collectSourceVersionSnapshot({ root, pluginName });

  assert.equal(sourceVersionsDiffer(snapshot), true);
  assert.match(snapshot.errorMessage, /source versions differ/);
  assert.match(snapshot.errorMessage, /codex plugin=0\.2\.2/);
});
