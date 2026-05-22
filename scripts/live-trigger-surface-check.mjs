#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import {
  loadLiveSurfaceMatrix,
  renderLiveSurfaceMarkdown,
  validateLiveSurfaceMatrix,
} from './lib/live-surface-matrix.mjs';

const [mode, ...modeArgs] = process.argv.slice(2);

if (mode === 'render-matrix') {
  const args = parseArgs(modeArgs);
  const root = resolve(args.root || process.cwd());
  const matrixPath = args.matrix || '.agent-trigger-kit/live-surfaces.yaml';
  const output = args.output;

  if (typeof output !== 'string' || output.trim() === '') {
    console.error('render-matrix requires --output');
    process.exit(2);
  }

  const outputPath = resolve(root, output);
  const outputRelativePath = relative(root, outputPath);
  if (
    isAbsolute(output) ||
    outputRelativePath === '..' ||
    outputRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(outputRelativePath)
  ) {
    console.error('render-matrix --output must stay within --root');
    process.exit(2);
  }

  const matrix = loadLiveSurfaceMatrix({ root, matrixPath });
  const validation = validateLiveSurfaceMatrix({ root, matrix });
  if (validation.errors.length > 0) {
    console.error(validation.errors.join('\n'));
    process.exit(3);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderLiveSurfaceMarkdown(matrix));
  console.log(`wrote ${output}`);
  process.exit(0);
}

console.error(`${mode || 'live-check'} is not implemented yet; use render-matrix`);
process.exit(2);
