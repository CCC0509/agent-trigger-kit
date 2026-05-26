const CLEAN_SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function tagNameForVersion(expectedVersion) {
  if (!CLEAN_SEMVER_RE.test(expectedVersion || '')) {
    return {
      ok: false,
      reason: 'expected source version must be clean SemVer x.y.z',
    };
  }
  return { ok: true, tagName: `v${expectedVersion}` };
}

export function decideReleaseTag({
  expectedVersion,
  head,
  tagTarget = null,
  sourceErrorMessage = '',
}) {
  const version = tagNameForVersion(expectedVersion);
  const tagName = version.ok ? version.tagName : null;

  if (!version.ok) {
    return blocked({
      expectedVersion,
      head,
      tagName,
      tagTarget,
      reason: version.reason,
    });
  }

  if (sourceErrorMessage) {
    return blocked({
      expectedVersion,
      head,
      tagName,
      tagTarget,
      reason: sourceErrorMessage,
    });
  }

  if (!head) {
    return blocked({
      expectedVersion,
      head,
      tagName,
      tagTarget,
      reason: 'HEAD commit is unavailable',
    });
  }

  if (!tagTarget) {
    return {
      action: 'create',
      tagName,
      expectedVersion,
      head,
      tagTarget: null,
      reason: 'tag is missing',
      warning: null,
      shouldCreate: true,
      shouldPush: true,
    };
  }

  if (tagTarget === head) {
    return {
      action: 'noop_current',
      tagName,
      expectedVersion,
      head,
      tagTarget,
      reason: 'tag already points at HEAD',
      warning: null,
      shouldCreate: false,
      shouldPush: false,
    };
  }

  return {
    action: 'warn_existing',
    tagName,
    expectedVersion,
    head,
    tagTarget,
    reason: 'tag already exists at a different commit',
    warning: `${tagName} already points at ${tagTarget}; leaving it unchanged instead of moving a published tag`,
    shouldCreate: false,
    shouldPush: false,
  };
}

function blocked({ expectedVersion, head, tagName, tagTarget, reason }) {
  return {
    action: 'blocked',
    tagName,
    expectedVersion,
    head: head || null,
    tagTarget,
    reason,
    warning: null,
    shouldCreate: false,
    shouldPush: false,
  };
}
