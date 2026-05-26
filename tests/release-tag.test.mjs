import assert from 'node:assert/strict';
import test from 'node:test';

import { decideReleaseTag, tagNameForVersion } from '../scripts/lib/release-tag.mjs';

test('tagNameForVersion accepts clean semver and prefixes v', () => {
  assert.deepEqual(tagNameForVersion('0.2.7'), {
    ok: true,
    tagName: 'v0.2.7',
  });
});

test('tagNameForVersion rejects non-clean semver', () => {
  assert.deepEqual(tagNameForVersion('0.2.7-rc.1'), {
    ok: false,
    reason: 'expected source version must be clean SemVer x.y.z',
  });
  assert.deepEqual(tagNameForVersion('v0.2.7'), {
    ok: false,
    reason: 'expected source version must be clean SemVer x.y.z',
  });
});

test('decideReleaseTag blocks when source versions are inconsistent', () => {
  const head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  assert.deepEqual(
    decideReleaseTag({
      expectedVersion: '0.2.7',
      head,
      sourceErrorMessage: 'source versions differ',
      tagTarget: null,
    }),
    {
      action: 'blocked',
      expectedVersion: '0.2.7',
      head,
      reason: 'source versions differ',
      shouldCreate: false,
      shouldPush: false,
      tagName: 'v0.2.7',
      tagTarget: null,
      warning: null,
    },
  );
});

test('decideReleaseTag blocks when expected version is not clean semver', () => {
  const head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  assert.deepEqual(
    decideReleaseTag({
      expectedVersion: 'v0.2.7',
      head,
      tagTarget: null,
    }),
    {
      action: 'blocked',
      expectedVersion: 'v0.2.7',
      head,
      reason: 'expected source version must be clean SemVer x.y.z',
      shouldCreate: false,
      shouldPush: false,
      tagName: null,
      tagTarget: null,
      warning: null,
    },
  );
});

test('decideReleaseTag blocks when HEAD is unavailable', () => {
  assert.deepEqual(
    decideReleaseTag({
      expectedVersion: '0.2.7',
      head: null,
      tagTarget: null,
    }),
    {
      action: 'blocked',
      expectedVersion: '0.2.7',
      head: null,
      reason: 'HEAD commit is unavailable',
      shouldCreate: false,
      shouldPush: false,
      tagName: 'v0.2.7',
      tagTarget: null,
      warning: null,
    },
  );
});

test('decideReleaseTag creates a missing clean semver tag at HEAD', () => {
  const head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  assert.deepEqual(
    decideReleaseTag({
      expectedVersion: '0.2.7',
      head,
      tagTarget: null,
    }),
    {
      action: 'create',
      expectedVersion: '0.2.7',
      head,
      reason: 'tag is missing',
      shouldCreate: true,
      shouldPush: true,
      tagName: 'v0.2.7',
      tagTarget: null,
      warning: null,
    },
  );
});

test('decideReleaseTag no-ops when the tag already points at HEAD', () => {
  const head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  assert.deepEqual(
    decideReleaseTag({
      expectedVersion: '0.2.7',
      head,
      tagTarget: head,
    }),
    {
      action: 'noop_current',
      expectedVersion: '0.2.7',
      head,
      reason: 'tag already points at HEAD',
      shouldCreate: false,
      shouldPush: false,
      tagName: 'v0.2.7',
      tagTarget: head,
      warning: null,
    },
  );
});

test('decideReleaseTag warns but never moves an existing tag at another commit', () => {
  const head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const tagTarget = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  assert.deepEqual(
    decideReleaseTag({
      expectedVersion: '0.2.7',
      head,
      tagTarget,
    }),
    {
      action: 'warn_existing',
      expectedVersion: '0.2.7',
      head,
      reason: 'tag already exists at a different commit',
      shouldCreate: false,
      shouldPush: false,
      tagName: 'v0.2.7',
      tagTarget,
      warning:
        'v0.2.7 already points at bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; leaving it unchanged instead of moving a published tag',
    },
  );
});
