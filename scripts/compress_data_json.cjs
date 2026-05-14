#!/usr/bin/env node

const { createGzip } = require('node:zlib');
const { createReadStream, createWriteStream, readdirSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');
const { pipeline } = require('node:stream/promises');

const root = process.cwd();
const dataDir = join(root, 'data');

function collectJsonFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsonFiles(path));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(path);
    }
  }

  return files.sort();
}

async function compressJsonFile(path) {
  const target = `${path}.gz`;
  await pipeline(
    createReadStream(path),
    createGzip({ level: 9 }),
    createWriteStream(target)
  );

  const sourceStat = statSync(path);
  const targetStat = statSync(target);
  return {
    path: relative(root, path),
    target: relative(root, target),
    sourceBytes: sourceStat.size,
    targetBytes: targetStat.size,
  };
}

async function main() {
  const files = collectJsonFiles(dataDir);
  let sourceBytes = 0;
  let targetBytes = 0;

  for (const file of files) {
    const result = await compressJsonFile(file);
    sourceBytes += result.sourceBytes;
    targetBytes += result.targetBytes;
    console.log(`${result.target} ${result.sourceBytes} -> ${result.targetBytes}`);
  }

  const ratio = sourceBytes > 0 ? ((targetBytes / sourceBytes) * 100).toFixed(1) : '0.0';
  console.log(`Compressed ${files.length} JSON files from ${sourceBytes} to ${targetBytes} bytes (${ratio}%).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
