#!/usr/bin/env node

const { cpSync, existsSync, mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const root = process.cwd();
const standaloneDir = join(root, '.next', 'standalone');
const staticSource = join(root, '.next', 'static');
const staticTarget = join(standaloneDir, '.next', 'static');
const publicSource = join(root, 'public');
const publicTarget = join(standaloneDir, 'public');

if (!existsSync(standaloneDir)) {
  throw new Error('Missing .next/standalone. Run `npm run build` before `npm run start`.');
}

if (!existsSync(staticSource)) {
  throw new Error('Missing .next/static. Run `npm run build` before `npm run start`.');
}

mkdirSync(join(standaloneDir, '.next'), { recursive: true });
rmSync(staticTarget, { recursive: true, force: true });
cpSync(staticSource, staticTarget, { recursive: true });

if (existsSync(publicSource) && !existsSync(publicTarget)) {
  cpSync(publicSource, publicTarget, { recursive: true });
}
