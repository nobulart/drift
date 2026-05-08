import { promises as fs } from 'fs';
import { gunzip } from 'zlib';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { NextResponse } from 'next/server';

const gunzipAsync = promisify(gunzip);
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};
const MAX_PARSED_CACHE_BYTES = 25 * 1024 * 1024;

interface ParsedJsonCacheEntry {
  mtimeMs: number;
  size: number;
  value: unknown;
}

const parsedJsonCache = new Map<string, ParsedJsonCacheEntry>();

export function noStoreJson<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...init?.headers,
    },
  });
}

export async function readPipelineJson<T>(filename: string): Promise<T> {
  const candidates = [
    join(process.cwd(), 'data', filename),
    join(process.cwd(), 'public', 'data', filename),
  ];

  for (const filePath of candidates) {
    try {
      const stat = await fs.stat(filePath);
      const cached = parsedJsonCache.get(filePath);
      if (
        cached &&
        cached.mtimeMs === stat.mtimeMs &&
        cached.size === stat.size
      ) {
        return cached.value as T;
      }

      const dataStr = await fs.readFile(filePath, 'utf8');
      const value = JSON.parse(dataStr) as T;
      if (stat.size <= MAX_PARSED_CACHE_BYTES) {
        parsedJsonCache.set(filePath, {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          value,
        });
      }
      return value;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  const compressedCandidates = candidates.map((candidate) => `${candidate}.gz`);

  for (const filePath of compressedCandidates) {
    try {
      const data = await fs.readFile(filePath);
      const dataStr = (await gunzipAsync(data)).toString('utf8');
      return JSON.parse(dataStr) as T;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  throw new Error(`Unable to locate ${filename}`);
}

export async function materializePipelineJson(filename: string): Promise<string> {
  const candidates = [
    join(process.cwd(), 'data', filename),
    join(process.cwd(), 'public', 'data', filename),
  ];

  for (const filePath of candidates) {
    try {
      await fs.access(filePath);
      return filePath;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  for (const compressedPath of candidates.map((candidate) => `${candidate}.gz`)) {
    try {
      const compressed = await fs.readFile(compressedPath);
      const targetPath = compressedPath.slice(0, -3);
      await fs.mkdir(dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, await gunzipAsync(compressed));
      return targetPath;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  throw new Error(`Unable to locate ${filename}`);
}
