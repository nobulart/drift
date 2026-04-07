import { promises as fs } from 'fs';
import { join } from 'path';

export async function readPipelineJson<T>(filename: string): Promise<T> {
  const candidates = [
    join(process.cwd(), 'data', filename),
    join(process.cwd(), 'public', 'data', filename),
  ];

  for (const filePath of candidates) {
    try {
      const dataStr = await fs.readFile(filePath, 'utf8');
      return JSON.parse(dataStr) as T;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  throw new Error(`Unable to locate ${filename}`);
}
