import { execSync, execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

execSync('node --experimental-strip-types scripts/snapshots-report.ts', { cwd: root, stdio: 'inherit' });

const cairn = 'node --experimental-strip-types src/cli.ts';
const dirs = ['examples', 'examples/dispositions', 'examples/themes'];

console.log('• rebuilding diagram SVGs…');
let n = 0, warn = 0;
for (const dir of dirs) {
  let files;
  try { files = readdirSync(join(root, dir)).filter(f => f.endsWith('.cairn') && !f.includes('broken')); } catch { continue; }
  for (const f of files) {
    const src = join(root, dir, f);
    const out = join(root, dir, f.replace(/\.cairn$/, '.svg'));
    const result = execSync(`${cairn} build "${src}" -o "${out}"`, { cwd: root, encoding: 'utf-8' });
    if (!result.includes('label overlaps: 0')) {
      console.log(`  ⚠ overlaps in ${f} — ${result}`);
      warn++;
    }
    n++;
  }
}
console.log(`  ✓ ${n} diagrams${warn ? `, ${warn} with overlaps` : ''}`);

console.log('• rebuilding matrix companions…');
let m = 0;
const flowFiles = readdirSync(join(root, 'examples')).filter(f => f.includes('.flow.'));
for (const flow of flowFiles) {
  const src = join(root, 'examples', flow.replace(/\.flow\..+$/, '.cairn'));
  if (!existsSync(src)) {
    console.log(`  ! no source for ${flow} — skipped`);
    continue;
  }
  const fmt = flow.split('.').pop();
  execFileSync('node', ['--experimental-strip-types', 'src/cli.ts', 'matrix', src, '--format', fmt, '-o', join(root, 'examples', flow)], { cwd: root });
  m++;
}
console.log(`  ✓ ${m} matrix files`);

if (warn === 0) {
  console.log('✓ examples regenerated');
} else {
  console.error(`✗ ${warn} diagram(s) have label overlaps — fix before committing`);
  process.exit(1);
}
