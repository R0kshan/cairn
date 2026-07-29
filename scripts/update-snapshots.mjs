import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

process.env.UPDATE_SNAPSHOTS = '1';
const { spawnSync } = await import('node:child_process');
const root = dirname(fileURLToPath(import.meta.url));
spawnSync(process.execPath, [
  '--experimental-strip-types', '--test',
  'tests/snapshot.test.ts', 'tests/corpus.test.ts',
], { stdio: 'inherit', cwd: resolve(root, '..') });
