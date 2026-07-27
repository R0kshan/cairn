process.env.UPDATE_SNAPSHOTS = '1';
const { spawnSync } = await import('node:child_process');
spawnSync(process.execPath, [
  '--experimental-strip-types', '--test',
  'tests/snapshot.test.ts', 'tests/corpus.test.ts',
], { stdio: 'inherit', cwd: new URL('..', import.meta.url).pathname });
