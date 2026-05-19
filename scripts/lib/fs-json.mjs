import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function createPathOf(root) {
  return (path) => join(root, path);
}

export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readJsonFileOrExit(path) {
  try {
    return readJsonFile(path);
  } catch (error) {
    console.error(`${path}: ${error.message}`);
    process.exit(1);
  }
}

export function readJsonFileIfExists(path, fallback) {
  if (!existsSync(path)) return fallback;
  return readJsonFile(path);
}

export function readJsonFileIfExistsOrExit(path, fallback) {
  if (!existsSync(path)) return fallback;
  return readJsonFileOrExit(path);
}

export function writeJsonFile(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeJsonFileCreatingParents(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeJsonFile(path, value);
}

export function updateJsonFileIfExists(path, mutate) {
  if (!existsSync(path)) return false;
  const value = readJsonFile(path);
  mutate(value);
  writeJsonFile(path, value);
  return true;
}
