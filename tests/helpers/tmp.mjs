import { chmodSync, lstatSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeTempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => {
    makeRemovable(dir);
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function makeRemovable(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return;
  }

  if (!stat.isDirectory()) return;

  chmodSync(path, 0o700);
  for (const entry of readdirSync(path)) {
    makeRemovable(join(path, entry));
  }
}
