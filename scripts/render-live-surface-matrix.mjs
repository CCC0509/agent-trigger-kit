#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import {
  loadLiveSurfaceMatrix,
  renderLiveSurfaceMarkdown,
  validateLiveSurfaceMatrix,
} from './lib/live-surface-matrix.mjs';

const DEFAULT_MATRIX_PATH = '.agent-trigger-kit/live-surfaces.yaml';
const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root || process.cwd());
const matrixPath = args.matrix || DEFAULT_MATRIX_PATH;
const output = args.output;

if (typeof output !== 'string' || output.trim() === '') {
  console.error('render-matrix requires --output');
  process.exit(2);
}

const outputPath = resolve(root, output);
if (!outputPathStaysWithinRoot({ root, output, outputPath })) {
  console.error('render-matrix --output must stay within --root');
  process.exit(2);
}

const matrix = loadLiveSurfaceMatrix({ root, matrixPath });
const validation = validateLiveSurfaceMatrix({ matrix });
if (validation.errors.length > 0) {
  console.error(validation.errors.join('\n'));
  process.exit(3);
}

mkdirSync(dirname(outputPath), { recursive: true });
if (!realOutputPathStaysWithinRoot({ root, outputPath })) {
  console.error('render-matrix --output must stay within --root');
  process.exit(2);
}

writeFileSync(outputPath, renderLiveSurfaceMarkdown(matrix));
console.log(`wrote ${output}`);

function outputPathStaysWithinRoot({ root, output, outputPath }) {
  const outputRelativePath = relative(root, outputPath);
  return (
    !isAbsolute(output) &&
    outputRelativePath !== '..' &&
    !outputRelativePath.startsWith(`..${sep}`) &&
    !isAbsolute(outputRelativePath)
  );
}

function realOutputPathStaysWithinRoot({ root, outputPath }) {
  const realRoot = realpathSync(root);
  const pathToCheck =
    existsSync(outputPath) && lstatSync(outputPath).isSymbolicLink()
      ? realpathSync(outputPath)
      : realpathSync(dirname(outputPath));
  const realRelativePath = relative(realRoot, pathToCheck);
  return (
    realRelativePath !== '..' &&
    !realRelativePath.startsWith(`..${sep}`) &&
    !isAbsolute(realRelativePath)
  );
}
