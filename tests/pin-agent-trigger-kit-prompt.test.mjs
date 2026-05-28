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
  assertIncludes(prompt, '**Version:** v7.1-interactive-local-first');
  assertIncludes(prompt, 'Prompt (v7.1-interactive-local-first)');
  assert.ok(
    prompt.indexOf('**Version:** v7.1-interactive-local-first') <
      prompt.indexOf('## Prompt (v7.1-interactive-local-first)'),
    'expected metadata before active prompt',
  );
  assert.doesNotMatch(
    prompt,
    /KIT_SPEC="github:\$\{KIT_REPO\}#\$\(cat \.agent-trigger-kit\/pin\)"/,
  );
  assert.doesNotMatch(prompt, /KIT_SPEC="github:\$\{KIT_REPO\}#\$\(cat "\$PIN_FILE"\)"/);
  assert.doesNotMatch(prompt, /\$\{KIT_REPO:-CCC0509\/agent-trigger-kit\}/);
  assert.doesNotMatch(prompt, /KIT_REPO:-/);
  assertIncludes(prompt, 'KIT_REF="$(tr -d \'[:space:]\' < "$PIN_FILE")"');
  assertIncludes(prompt, 'KIT_SPEC="github:${KIT_REPO}#$KIT_REF"');
});

test('pin prompt main flow carries closeout invocation policy', () => {
  const mainPrompt = sectionBetween(
    '## Prompt (v7.1-interactive-local-first)',
    '## Existing v4-final Repos Closeout Addendum',
  );

  assertIncludes(mainPrompt, 'Closeout invocation policy');
  assertIncludes(mainPrompt, 'Session closeout check');
  assertIncludes(mainPrompt, '"kind": "session_check"');
  assertIncludes(mainPrompt, '"mode": "closeout"');
  assertIncludes(mainPrompt, 'Do not run a later tier to mask a non-zero closeout result');
  assertIncludes(mainPrompt, 'ROOT="${ROOT:-.}"');
  assertIncludes(mainPrompt, 'LOCAL_ATK="$ROOT/node_modules/.bin/agent-trigger-kit"');
  assertIncludes(mainPrompt, '[ -x "$LOCAL_ATK" ]');
  assertIncludes(mainPrompt, 'agent-trigger-kit local binary missing; status=not_installed');
  assertIncludes(mainPrompt, 'PIN_FILE="$ROOT/.agent-trigger-kit/pin"');
  assertIncludes(
    mainPrompt,
    'agent-trigger-kit pin missing at $PIN_FILE; status=skipped_missing_pin',
  );
  assertIncludes(mainPrompt, 'KIT_REPO="<owner>/<repo>"');
  assertIncludes(mainPrompt, 'KIT_REF="$(tr -d \'[:space:]\' < "$PIN_FILE")"');
  assertIncludes(mainPrompt, 'KIT_SPEC="github:${KIT_REPO}#$KIT_REF"');
  assertIncludes(mainPrompt, 'npx --yes "$KIT_SPEC" session-check --closeout --root "$ROOT"');
  assertIncludes(mainPrompt, 'agent-trigger-kit --version');
  assertIncludes(mainPrompt, 'path_non_semver_pin');
  assertIncludes(mainPrompt, 'path_version_mismatch');
  assertIncludes(mainPrompt, 'path_version_unknown');
  assertIncludes(mainPrompt, 'command -v agent-trigger-kit');
  assertIncludes(mainPrompt, 'capture_command_output');
  assertIncludes(mainPrompt, 'errexit');
  assert.match(mainPrompt, /version equality[\s\S]*not proof|not proof[\s\S]*version equality/i);
  assert.match(mainPrompt, /opportunistic|low-integrity/i);
  assert.doesNotMatch(mainPrompt, /npx --no-install agent-trigger-kit session-check --closeout/);
  assert.doesNotMatch(mainPrompt, /CLAUDE_PROJECT_DIR/);
  assert.doesNotMatch(
    mainPrompt,
    /KIT_SPEC="github:\$\{KIT_REPO\}#\$\(cat "\$PIN_FILE"\)"\s+npx --yes "\$KIT_SPEC" session-check --closeout --root "\$ROOT"/,
  );
  assert.doesNotMatch(
    mainPrompt,
    /KIT_SPEC="github:\$\{KIT_REPO\}#\$\(cat \.agent-trigger-kit\/pin\)"/,
  );
  assertIncludes(mainPrompt, 'not_installed');
  assertIncludes(mainPrompt, 'skipped_missing_pin');
  assertIncludes(mainPrompt, 'blocked_by_policy');
  assertIncludes(mainPrompt, 'invocation_error');
  assertIncludes(mainPrompt, 'ambiguous no-report failures default to invocation_error');
  assertIncludes(mainPrompt, 'AGENTS.md snippet 必須同時包含');
  assertIncludes(mainPrompt, 'atk_run()');
  assertIncludes(mainPrompt, 'run_validate()');
  assertIncludes(mainPrompt, 'interactive_skipped_local_first');
  assertIncludes(mainPrompt, 'interactive_validate_unverified');
  assertIncludes(mainPrompt, 'interactive_outcome_unavailable');
  assertIncludes(mainPrompt, 'case "$rc" in');
  assertIncludes(mainPrompt, 'validate FAILED; exit=$rc');
  assert.doesNotMatch(
    mainPrompt,
    /At session start:\s+`npx --yes "\$KIT_SPEC" session-check --root \.`/,
  );
  assert.doesNotMatch(
    mainPrompt,
    /trigger surface 變更後跑：\s+npx --yes "\$KIT_SPEC" validate --root \./,
  );
  assertIncludes(mainPrompt, 'closeout invocation policy 已寫入 AGENTS.md / Cursor 指令');

  const agentsTaxonomy = sectionBetween(
    '- closeout blocked / failed 時，使用',
    '3. Renovate config',
  );
  assertIncludes(agentsTaxonomy, 'path_not_found');
  assertIncludes(agentsTaxonomy, 'path_duplicate_local');

  const finalReport = sectionBetween(
    '最後回報（逐項）',
    '## Existing v4-final Repos Closeout Addendum',
  );
  assertIncludes(finalReport, 'path_not_found');
  assertIncludes(finalReport, 'path_duplicate_local');
  assertIncludes(finalReport, 'path_non_semver_pin');
  assertIncludes(finalReport, 'path_version_unknown');
  assertIncludes(finalReport, 'path_version_mismatch');
});

test('pin prompt addendum gives already-v4 repos a no-rerun migration path', () => {
  const addendum = sectionBetween(
    '## Existing v4-final Repos Closeout Addendum',
    '## Existing v7-verified-path-fallback Repos Interactive Local-First Addendum',
  );

  assertIncludes(addendum, 'This repo already ran Agent Trigger Kit Prompt (v4-final)');
  assertIncludes(addendum, 'Do not rerun the full pin/Renovate/CI setup');
  assertIncludes(addendum, 'Do not change `.agent-trigger-kit/pin`, Renovate, or CI');
  assertIncludes(addendum, 'AGENTS.md / CLAUDE.md / Cursor');
  assertIncludes(addendum, 'Session closeout check');
  assertIncludes(addendum, '"kind": "session_check"');
  assertIncludes(addendum, '"mode": "closeout"');
  assertIncludes(addendum, 'ROOT="${ROOT:-.}"');
  assertIncludes(addendum, 'LOCAL_ATK="$ROOT/node_modules/.bin/agent-trigger-kit"');
  assertIncludes(addendum, '[ -x "$LOCAL_ATK" ]');
  assertIncludes(addendum, 'PIN_FILE="$ROOT/.agent-trigger-kit/pin"');
  assertIncludes(addendum, 'KIT_REPO="<owner>/<repo>"');
  assertIncludes(addendum, 'KIT_REF="$(tr -d \'[:space:]\' < "$PIN_FILE")"');
  assertIncludes(addendum, 'KIT_SPEC="github:${KIT_REPO}#$KIT_REF"');
  assertIncludes(addendum, 'agent-trigger-kit --version');
  assertIncludes(addendum, 'path_non_semver_pin');
  assertIncludes(addendum, 'path_version_mismatch');
  assertIncludes(addendum, 'path_version_unknown');
  assertIncludes(addendum, 'command -v agent-trigger-kit');
  assertIncludes(addendum, 'capture_command_output');
  assertIncludes(addendum, 'errexit');
  assert.match(addendum, /version equality[\s\S]*not proof|not proof[\s\S]*version equality/i);
  assert.match(addendum, /opportunistic|low-integrity/i);
  assert.doesNotMatch(addendum, /npx --no-install agent-trigger-kit session-check --closeout/);
  assert.doesNotMatch(addendum, /CLAUDE_PROJECT_DIR/);
  assert.doesNotMatch(
    addendum,
    /KIT_SPEC="github:\$\{KIT_REPO\}#\$\(cat "\$PIN_FILE"\)"\s+npx --yes "\$KIT_SPEC" session-check --closeout --root "\$ROOT"/,
  );
  assert.doesNotMatch(
    addendum,
    /KIT_SPEC="github:\$\{KIT_REPO\}#\$\(cat \.agent-trigger-kit\/pin\)"/,
  );
  assertIncludes(addendum, 'npx --yes "$KIT_SPEC" session-check --closeout --root "$ROOT"');
  assertIncludes(addendum, 'skipped_missing_pin');
  assertIncludes(addendum, 'blocked_by_policy');
  assertIncludes(addendum, 'invocation_error');
  assertIncludes(addendum, 'Do not open a second pin setup PR');
});

test('pin prompt addendum gives v7 repos an interactive local-first migration path', () => {
  const addendum = sectionBetween(
    '## Existing v7-verified-path-fallback Repos Interactive Local-First Addendum',
    '## Changelog',
  );

  assertIncludes(
    addendum,
    'This repo already ran Agent Trigger Kit Prompt (v7-verified-path-fallback)',
  );
  assertIncludes(addendum, 'Do not rerun the full pin/Renovate/CI setup');
  assertIncludes(addendum, 'Do not change `.agent-trigger-kit/pin`, Renovate, or CI');
  assertIncludes(addendum, 'session-start');
  assertIncludes(addendum, 'validate');
  assertIncludes(addendum, 'outcome record');
  assertIncludes(addendum, 'atk_run()');
  assertIncludes(addendum, 'run_validate()');
  assertIncludes(addendum, 'interactive_validate_unverified');
  assertIncludes(addendum, 'path_non_semver_pin');
  assertIncludes(addendum, 'case "$rc" in');
  assertIncludes(addendum, 'validate FAILED; exit=$rc');
  assert.doesNotMatch(addendum, /npx --yes "\$KIT_SPEC" session-check --root \./);
  assert.doesNotMatch(addendum, /npx --yes "\$KIT_SPEC" validate --root \./);
});

test('pin prompt changelog records the verified PATH fallback revision', () => {
  const changelog = sectionFrom('## Changelog');

  assertIncludes(changelog, '**v7.1-interactive-local-first**');
  assertIncludes(changelog, '**v7-verified-path-fallback**');
  assertIncludes(changelog, 'interactive local-first');
  assertIncludes(changelog, 'Future');
  assertIncludes(changelog, 'verified PATH fallback');
  assertIncludes(changelog, '**v6-localbin-guard**');
  assertIncludes(changelog, 'local-bin guard');
  assertIncludes(changelog, '**v5-closeout-policy**');
  assertIncludes(changelog, 'existing-v4 migration addendum');
  assert.ok(
    changelog.indexOf('**v7.1-interactive-local-first**') <
      changelog.indexOf('**v7-verified-path-fallback**'),
    'expected v7.1 changelog entry before v7-verified-path-fallback',
  );
  assert.ok(
    changelog.indexOf('**v7-verified-path-fallback**') < changelog.indexOf('**v6-localbin-guard**'),
    'expected v7 changelog entry before v6-localbin-guard',
  );
  assert.ok(
    changelog.indexOf('**v6-localbin-guard**') < changelog.indexOf('**v5-closeout-policy**'),
    'expected v6 changelog entry before v5-closeout-policy',
  );
});
