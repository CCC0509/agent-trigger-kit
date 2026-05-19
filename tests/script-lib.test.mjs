import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseArgs } from '../scripts/lib/args.mjs';
import {
  createPathOf,
  readJsonFileIfExists,
  readJsonFileIfExistsOrExit,
  updateJsonFileIfExists,
  writeJsonFileCreatingParents,
} from '../scripts/lib/fs-json.mjs';

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'agent-trigger-kit-lib-test-'));
}

test('parseArgs supports options, booleans, and positional arguments', () => {
  const args = parseArgs([
    '--root',
    '/tmp/project',
    '--strict-installed',
    'agent-trigger-kit',
    '--dry-run',
  ], {
    booleanKeys: ['strict-installed'],
    collectPositionals: true,
  });

  assert.deepEqual(args, {
    _: ['agent-trigger-kit'],
    root: '/tmp/project',
    'strict-installed': true,
    'dry-run': true,
  });
});

test('parseArgs ignores positionals when positional collection is disabled', () => {
  const args = parseArgs(['ignored', '--plugin', 'demo-ops']);

  assert.deepEqual(args, { plugin: 'demo-ops' });
});

test('fs json helpers read, write, and update rooted JSON files', () => {
  const root = makeRoot();
  const pathOf = createPathOf(root);
  const path = pathOf('nested/value.json');

  assert.equal(readJsonFileIfExists(path, { missing: true }).missing, true);

  writeJsonFileCreatingParents(path, { version: '0.1.0' });
  assert.equal(existsSync(path), true);
  assert.equal(readFileSync(path, 'utf8'), '{\n  "version": "0.1.0"\n}\n');

  const updated = updateJsonFileIfExists(path, (value) => {
    value.version = '0.1.1';
  });

  assert.equal(updated, true);
  assert.deepEqual(readJsonFileIfExists(path, null), { version: '0.1.1' });
  assert.deepEqual(readJsonFileIfExistsOrExit(path, null), { version: '0.1.1' });
  assert.equal(updateJsonFileIfExists(pathOf('missing.json'), () => {}), false);
});
