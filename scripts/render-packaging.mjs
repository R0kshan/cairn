#!/usr/bin/env node
// Render the release-specific Homebrew formula and Scoop manifest.
//
// Source templates (packaging/cairn.rb, packaging/cairn.json) carry a version
// and `REPLACED_BY_RELEASE_WORKFLOW` sha256 placeholders. This script injects
// the real version and the per-asset checksums produced by build-binaries.sh,
// writing the finished files to dist/ ready to be pushed to the tap/bucket repos.
//
// Usage: node scripts/render-packaging.mjs <version> <checksums-file>
//   e.g. node scripts/render-packaging.mjs 0.1.0 dist/cairn-0.1.0-checksums.txt
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist'), { recursive: true });

const version = process.argv[2];
const checksumsFile = process.argv[3];
if (!version || !checksumsFile) {
  console.error('usage: render-packaging.mjs <version> <checksums-file>');
  process.exit(2);
}

// Parse `<sha256>  <filename>` lines into { basename -> sha }.
const sums = {};
for (const line of readFileSync(checksumsFile, 'utf8').split('\n')) {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 2) continue;
  const sha = parts[0];
  const name = parts[parts.length - 1].replace(/^\.\//, '');
  if (/^[0-9a-f]{64}$/i.test(sha)) sums[name] = sha.toLowerCase();
}

// The licence texts are release assets too — the binaries inline elkjs
// (EPL-2.0) and the Simple Icons artwork, so the notices have to reach whoever
// installs one. Their checksums are computed from the files in the repo, which
// are byte-for-byte what release.yml uploads.
const NOTICE_ASSETS = {
  LICENSE: 'LICENSE',
  'THIRD-PARTY-NOTICES.md': 'THIRD-PARTY-NOTICES.md',
  'elkjs-EPL-2.0.md': 'licenses/elkjs-EPL-2.0.md',
  'simple-icons-CC0-1.0.md': 'licenses/simple-icons-CC0-1.0.md',
};
const noticeSha = (asset) =>
  createHash('sha256').update(readFileSync(join(root, NOTICE_ASSETS[asset]))).digest('hex');

const shaFor = (asset) => {
  const sha = sums[asset];
  if (!sha) {
    console.error(`no checksum found for asset "${asset}" in ${checksumsFile}`);
    console.error(`available: ${Object.keys(sums).join(', ')}`);
    process.exit(1);
  }
  return sha;
};

// ---- Homebrew formula ----------------------------------------------------
// Walk line by line: each `url ".../cairn-#{version}-<suffix>"` is followed by a
// sha256 placeholder line; fill it with the checksum for that suffix's asset.
const rbLines = readFileSync(join(root, 'packaging/cairn.rb'), 'utf8').split('\n');
let pendingSuffix = null;
let pendingNotice = null;
const rbOut = rbLines.map((line) => {
  const v = line.replace(/version\s+"[^"]*"/, `version "${version}"`);
  const m = line.match(/cairn-#\{version\}-([a-z0-9-]+)"/);
  if (m) { pendingSuffix = m[1]; return v; }
  // A `resource` block's url names a notice file rather than a binary; its
  // checksum comes from the repo copy that gets uploaded as that same asset.
  const n = line.match(/\/v#\{version\}\/([^"]+)"/);
  if (n && NOTICE_ASSETS[n[1]]) { pendingNotice = n[1]; return v; }
  if (pendingNotice && /sha256\s+"[^"]*"/.test(line)) {
    const out = line.replace(/sha256\s+"[^"]*"/, `sha256 "${noticeSha(pendingNotice)}"`);
    pendingNotice = null;
    return out;
  }
  if (pendingSuffix && /sha256\s+"[^"]*"/.test(line)) {
    const asset = `cairn-${version}-${pendingSuffix}`;
    const out = line.replace(/sha256\s+"[^"]*"/, `sha256 "${shaFor(asset)}"`);
    pendingSuffix = null;
    return out;
  }
  return v;
});
writeFileSync(join(root, 'dist/cairn.rb'), rbOut.join('\n'));

// ---- Scoop manifest ------------------------------------------------------
const manifest = JSON.parse(readFileSync(join(root, 'packaging/cairn.json'), 'utf8'));
const winAsset = `cairn-${version}-windows-x64.exe`;
const releaseBase = `https://github.com/R0kshan/cairn/releases/download/v${version}`;
manifest.version = version;
// The exe first, then the notices it has to travel with; scoop drops every URL
// into the app directory, so `bin` still points at the exe alone.
const noticeNames = Object.keys(NOTICE_ASSETS);
manifest.architecture['64bit'].url = [
  `${releaseBase}/${winAsset}`,
  ...noticeNames.map((name) => `${releaseBase}/${name}`),
];
manifest.architecture['64bit'].hash = [shaFor(winAsset), ...noticeNames.map(noticeSha)];
manifest.autoupdate.architecture['64bit'].url = [
  `https://github.com/R0kshan/cairn/releases/download/v$version/cairn-$version-windows-x64.exe`,
  ...noticeNames.map((name) => `https://github.com/R0kshan/cairn/releases/download/v$version/${name}`),
];
manifest.bin = [[winAsset, 'cairn']];
writeFileSync(join(root, 'dist/cairn.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`rendered dist/cairn.rb and dist/cairn.json for v${version}`);
