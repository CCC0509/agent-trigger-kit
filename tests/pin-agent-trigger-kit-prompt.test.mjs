import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const prompt = readFileSync(join(repoRoot, 'docs/prompts/pin-agent-trigger-kit.md'), 'utf8');

function assertIncludes(haystack, needle, label = needle) {
  assert.ok(haystack.includes(needle), `expected ${label}`);
}

function sectionBetween(startMarker, endMarker) {
  const start = prompt.indexOf(startMarker);
  assert.notEqual(start, -1, `expected ${startMarker}`);
  const end = prompt.indexOf(endMarker, start);
  assert.notEqual(end, -1, `expected ${endMarker} after ${startMarker}`);
  return prompt.slice(start, end);
}

function sectionFrom(startMarker) {
  const start = prompt.indexOf(startMarker);
  assert.notEqual(start, -1, `expected ${startMarker}`);
  return prompt.slice(start);
}

test('pin prompt metadata matches the active prompt version', () => {
  assertIncludes(prompt, '**Version:** v5-closeout-policy');
  assertIncludes(prompt, 'Prompt (v5-closeout-policy)');
  assert.ok(
    prompt.indexOf('**Version:** v5-closeout-policy') <
      prompt.indexOf('## Prompt (v5-closeout-policy)'),
    'expected metadata before active prompt',
  );
});

test('pin prompt main flow carries closeout invocation policy', () => {
  const mainPrompt = sectionBetween(
    '## Prompt (v5-closeout-policy)',
    '## Existing v4-final Repos Closeout Addendum',
  );

  assertIncludes(mainPrompt, 'Closeout invocation policy');
  assertIncludes(mainPrompt, 'Session closeout check');
  assertIncludes(mainPrompt, '"kind": "session_check"');
  assertIncludes(mainPrompt, '"mode": "closeout"');
  assertIncludes(mainPrompt, 'Do not run a later tier to mask a non-zero closeout result');
  assertIncludes(
    mainPrompt,
    'npx --no-install agent-trigger-kit session-check --closeout --root .',
  );
  assertIncludes(mainPrompt, 'npx --yes "$KIT_SPEC" session-check --closeout --root .');
  assertIncludes(mainPrompt, 'not_installed');
  assertIncludes(mainPrompt, 'skipped_missing_pin');
  assertIncludes(mainPrompt, 'blocked_by_policy');
  assertIncludes(mainPrompt, 'invocation_error');
  assertIncludes(mainPrompt, 'ambiguous no-report failures default to invocation_error');
  assertIncludes(mainPrompt, 'AGENTS.md snippet 必須同時包含');
  assertIncludes(mainPrompt, 'closeout invocation policy 已寫入 AGENTS.md / Cursor 指令');
});

test('pin prompt addendum gives already-v4 repos a no-rerun migration path', () => {
  const addendum = sectionBetween('## Existing v4-final Repos Closeout Addendum', '## Changelog');

  assertIncludes(addendum, 'This repo already ran Agent Trigger Kit Prompt (v4-final)');
  assertIncludes(addendum, 'Do not rerun the full pin/Renovate/CI setup');
  assertIncludes(addendum, 'Do not change `.agent-trigger-kit/pin`, Renovate, or CI');
  assertIncludes(addendum, 'AGENTS.md / CLAUDE.md / Cursor');
  assertIncludes(addendum, 'Session closeout check');
  assertIncludes(addendum, '"kind": "session_check"');
  assertIncludes(addendum, '"mode": "closeout"');
  assertIncludes(addendum, 'npx --no-install agent-trigger-kit session-check --closeout --root .');
  assertIncludes(addendum, 'npx --yes "$KIT_SPEC" session-check --closeout --root .');
  assertIncludes(addendum, 'blocked_by_policy');
  assertIncludes(addendum, 'invocation_error');
  assertIncludes(addendum, 'Do not open a second pin setup PR');
});

test('pin prompt changelog records the closeout-policy revision', () => {
  const changelog = sectionFrom('## Changelog');

  assertIncludes(changelog, '**v5-closeout-policy**');
  assertIncludes(changelog, 'existing-v4 migration addendum');
  assert.ok(
    changelog.indexOf('**v5-closeout-policy**') < changelog.indexOf('**v4-final**'),
    'expected v5 changelog entry before v4-final',
  );
});
