import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { makeTempDir } from './helpers/tmp.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const shipGateScripts = [
  'check:scratch-namespace',
  'ops:plugin-version-check',
  'lint',
  'format:check',
  'validate',
  'test',
];

function makeRoot(t, overrides = {}) {
  const root = makeTempDir(t, 'agent-trigger-kit-ship-gate-');
  const scripts = Object.fromEntries(
    shipGateScripts.map((name) => [name, passScript(name.replaceAll(':', '-'))]),
  );

  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        scripts: {
          ...scripts,
          ...overrides,
        },
      },
      null,
      2,
    )}\n`,
  );

  return root;
}

function passScript(label) {
  return `node -e "console.log('${label} ok')" --`;
}

function failScript(label) {
  return `node -e "console.error('${label} failed tail'); process.exit(7)" --`;
}

function hugeLineScript(label, size) {
  return `node -e "console.error('${label} ' + 'x'.repeat(${size})); process.exit(7)" --`;
}

function pluginVersionArgsScript() {
  const code = [
    "const expected = ['--surface', 'source', '--json', 'agent-trigger-kit'];",
    'const actual = process.argv.slice(1);',
    "if (actual.join('\\u0000') !== expected.join('\\u0000')) {",
    "  console.error('plugin argv ' + JSON.stringify(actual));",
    '  process.exit(9);',
    '}',
    "console.log('plugin version args ok');",
  ].join(' ');
  return `node -e ${JSON.stringify(code)} --`;
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', 'cli.mjs'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
}

test('ship-gate runs all checks and JSON reports six passed checks', (t) => {
  const root = makeRoot(t);

  const result = runCli(['ship-gate', '--root', root, '--json']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema_version, 1);
  assert.equal(report.command, 'ship-gate');
  assert.equal(report.status, 'passed');
  assert.equal(report.exit_reason, 'all_passed');
  assert.equal(report.checks.length, 6);
  assert.deepEqual(
    report.checks.map((check) => check.command),
    [
      'npm run check:scratch-namespace',
      'npm run ops:plugin-version-check -- --surface source --json agent-trigger-kit',
      'npm run lint',
      'npm run format:check',
      'npm run validate',
      'npm test',
    ],
  );
  assert.deepEqual(
    report.checks.map((check) => check.status),
    ['passed', 'passed', 'passed', 'passed', 'passed', 'passed'],
  );
  assert.ok(report.duration_ms >= 0);
  for (const check of report.checks) {
    assert.equal(check.exit_code, 0);
    assert.ok(check.duration_ms >= 0);
    assert.equal(check.stderr_tail, '');
  }
});

test('ship-gate runs plugin version check with source-only JSON args', (t) => {
  const root = makeRoot(t, {
    'ops:plugin-version-check': pluginVersionArgsScript(),
  });

  const result = runCli(['ship-gate', '--root', root, '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(
    report.checks[1].command,
    'npm run ops:plugin-version-check -- --surface source --json agent-trigger-kit',
  );
  assert.equal(report.checks[1].status, 'passed');
});

test('ship-gate JSON fail-fast stops after first failed check and captures stderr tail', (t) => {
  const root = makeRoot(t, {
    'check:scratch-namespace': failScript('scratch namespace'),
  });

  const result = runCli(['ship-gate', '--root', root, '--json']);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'failed');
  assert.equal(report.exit_reason, 'check_failed');
  assert.equal(report.checks.length, 1);
  assert.equal(report.checks[0].command, 'npm run check:scratch-namespace');
  assert.equal(report.checks[0].status, 'failed');
  assert.equal(report.checks[0].exit_code, 7);
  assert.match(report.checks[0].stderr_tail, /scratch namespace failed tail/);
});

test('ship-gate --continue-on-fail runs all six checks and reports first failed status', (t) => {
  const root = makeRoot(t, {
    'check:scratch-namespace': failScript('scratch namespace'),
  });

  const result = runCli(['ship-gate', '--root', root, '--json', '--continue-on-fail']);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'failed');
  assert.equal(report.exit_reason, 'check_failed');
  assert.equal(report.checks.length, 6);
  assert.equal(report.checks[0].command, 'npm run check:scratch-namespace');
  assert.equal(report.checks[0].status, 'failed');
  assert.equal(report.checks[0].exit_code, 7);
  assert.deepEqual(
    report.checks.slice(1).map((check) => check.status),
    ['passed', 'passed', 'passed', 'passed', 'passed'],
  );
});

test('ship-gate human output reports durations and final status', (t) => {
  const root = makeRoot(t);

  const result = runCli(['ship-gate', '--root', root]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Ship gate/m);
  assert.match(result.stdout, /npm run lint\s+passed\s+\d+ms/);
  assert.match(result.stdout, /npm test\s+passed\s+\d+ms/);
  assert.match(result.stdout, /Result: passed\s*$/);
});

test('ship-gate human mode streams child output before the summary', async (t) => {
  const root = makeRoot(t, {
    'check:scratch-namespace':
      'node -e "console.log(\'streamed child sentinel\'); setTimeout(() => {}, 600)"',
  });
  const child = spawn(
    process.execPath,
    [join(repoRoot, 'scripts', 'cli.mjs'), 'ship-gate', '--root', root],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let streamedBeforeClose = false;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout.includes('streamed child sentinel') && child.exitCode === null) {
      streamedBeforeClose = true;
    }
  });

  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
  });

  assert.equal(exitCode, 0);
  assert.equal(streamedBeforeClose, true, stdout);
  assert.ok(stdout.indexOf('streamed child sentinel') < stdout.indexOf('Ship gate'), stdout);
});

test('ship-gate invalid --root exits 2 in human mode', (t) => {
  const missingRoot = join(
    makeTempDir(t, 'agent-trigger-kit-ship-gate-missing-parent-'),
    'missing',
  );

  const result = runCli(['ship-gate', '--root', missingRoot]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--root must be an existing directory/);
  assert.doesNotMatch(result.stdout, /^Ship gate/m);
});

test('ship-gate invalid --root returns a structured JSON usage error', (t) => {
  const root = makeTempDir(t, 'agent-trigger-kit-ship-gate-file-root-');
  const fileRoot = join(root, 'not-a-directory');
  writeFileSync(fileRoot, 'not a directory\n');

  const result = runCli(['ship-gate', '--root', fileRoot, '--json']);

  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema_version, 1);
  assert.equal(report.command, 'ship-gate');
  assert.equal(report.status, 'failed');
  assert.equal(report.exit_reason, 'usage_error');
  assert.deepEqual(report.checks, []);
  assert.match(report.error.message, /--root must be an existing directory/);
});

test('ship-gate JSON tails cap large single-line failed output', (t) => {
  const root = makeRoot(t, {
    'check:scratch-namespace': hugeLineScript('oversized failure', 80_000),
  });

  const result = runCli(['ship-gate', '--root', root, '--json']);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.checks.length, 1);
  assert.equal(report.checks[0].status, 'failed');
  assert.match(report.checks[0].stderr_tail, /oversized failure|x/);
  assert.ok(
    Buffer.byteLength(report.checks[0].stderr_tail, 'utf8') <= 8192,
    `tail was ${Buffer.byteLength(report.checks[0].stderr_tail, 'utf8')} bytes`,
  );
});
