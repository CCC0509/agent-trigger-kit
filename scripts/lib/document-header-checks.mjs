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
