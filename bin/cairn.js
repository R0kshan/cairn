#!/usr/bin/env node
// Dev launcher for running cairn FROM A CHECKOUT (`npm run cairn`, or
// `node bin/cairn.js …`): re-executes node with --experimental-strip-types so
// src/cli.ts runs without users passing flags.
//
// This file is NOT published — it cannot work from an install. Node refuses to
// strip types for any file under node_modules
// (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), regardless of Node version or
// flags. The npm channel ships a pre-bundled bin/cairn.mjs instead; see
// scripts/build-cli.sh. Compiled binaries (`npm run build:binaries`) don't go
// through this file either.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts');
const major = Number(process.versions.node.split('.')[0]);
const minor = Number(process.versions.node.split('.')[1]);
if (major < 22 || (major === 22 && minor < 6)) {
  console.error(`cairn requires Node >= 22.6 (found ${process.versions.node}) — or use a released binary`);
  process.exit(2);
}
// Node >= 23.6 strips types by default; older needs the flag.
const flags = major >= 24 || (major === 23 && minor >= 6) ? [] : ['--experimental-strip-types', '--no-warnings'];
const r = spawnSync(process.execPath, [...flags, cli, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
