import { normalizeGitPath } from './git-base.mjs';

const EXACT_SOURCE_VISIBLE_PATHS = new Set([
  '.agents/plugins/marketplace.json',
  '.claude-plugin/marketplace.json',
  'package.json',
  'package-lock.json',
]);

function sourceVisiblePrefixes(pluginName) {
  return [`plugins/${pluginName}/`, 'scripts/', 'templates/'];
}

export function isSourceVisiblePath(path, pluginName = 'agent-trigger-kit') {
  const normalized = normalizeGitPath(path);
  if (EXACT_SOURCE_VISIBLE_PATHS.has(normalized)) return true;
  return sourceVisiblePrefixes(pluginName).some((prefix) => normalized.startsWith(prefix));
}

export function sourceVisibleChangedFiles(files, pluginName = 'agent-trigger-kit') {
  return files.map(normalizeGitPath).filter((file) => isSourceVisiblePath(file, pluginName));
}
