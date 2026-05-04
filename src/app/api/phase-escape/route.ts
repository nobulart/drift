import { NextRequest, NextResponse } from 'next/server';
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { materializePipelineJson } from '@/lib/serverData';

export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({
  windowSize: z.number().positive().default(1825),
  turnThreshold: z.number().positive().default(0.05),
  smoothDays: z.number().int().positive().default(31),
});

let pythonCommand: string | null = null;

function getPythonCommand() {
  if (pythonCommand) {
    return pythonCommand;
  }

  const candidates = [
    process.env.DRIFT_PYTHON,
    process.env.PYTHON,
    process.env.PYTHON3,
    join(process.cwd(), '.venv', 'bin', 'python'),
    join(process.env.HOME || '', '.pyenv', 'versions', '3.12.7', 'bin', 'python'),
    'python3',
    'python',
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const check = spawnSync(candidate, ['-c', 'import numpy, scipy, pandas'], {
      stdio: 'ignore',
    });

    if (check.status === 0) {
      pythonCommand = candidate;
      return pythonCommand;
    }
  }

  throw new Error('No Python interpreter with numpy, scipy, and pandas is available. Set DRIFT_PYTHON to a compatible interpreter.');
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const params = ParamsSchema.parse({
      windowSize: searchParams.get('windowSize') ? Number(searchParams.get('windowSize')) : 1825,
      turnThreshold: searchParams.get('turnThreshold') ? Number(searchParams.get('turnThreshold')) : 0.05,
      smoothDays: searchParams.get('smoothDays') ? Number(searchParams.get('smoothDays')) : 31,
    });

    const eopPath = await materializePipelineJson('eop_historic.json');
    const ephemerisPath = await materializePipelineJson('ephemeris_historic.json');

    const [eopStat, ephemerisStat] = await Promise.all([
      fs.stat(eopPath),
      fs.stat(ephemerisPath),
    ]);

    const cacheKey = crypto.createHash('md5')
      .update(JSON.stringify(params))
      .update(`${eopStat.mtimeMs}:${eopStat.size}`)
      .update(`${ephemerisStat.mtimeMs}:${ephemerisStat.size}`)
      .digest('hex');

    const cacheDir = join(process.cwd(), 'public', 'data', '.phase-escape-cache');
    const cachePath = join(cacheDir, `${cacheKey}.json`);
    await fs.mkdir(cacheDir, { recursive: true });

    try {
      const cached = await fs.readFile(cachePath, 'utf8');
      return NextResponse.json(JSON.parse(cached));
    } catch {
      // Cache miss.
    }

    await runPythonComputation(eopPath, ephemerisPath, cachePath, params);
    const dataStr = await fs.readFile(cachePath, 'utf8');
    return NextResponse.json(JSON.parse(dataStr));
  } catch (error) {
    console.error('Error computing phase escape model:', error);
    return NextResponse.json({ error: 'Failed to compute phase escape model' }, { status: 500 });
  }
}

async function runPythonComputation(
  eopPath: string,
  ephemerisPath: string,
  outputPath: string,
  params: z.infer<typeof ParamsSchema>
) {
  return new Promise<void>((resolve, reject) => {
    let command: string;
    try {
      command = getPythonCommand();
    } catch (error) {
      reject(error);
      return;
    }

    const scriptPath = join(process.cwd(), 'scripts', 'compute_phase_escape.py');
    const python = spawn(command, [
      scriptPath,
      '--eop', eopPath,
      '--ephemeris', ephemerisPath,
      '--output', outputPath,
      '--window-size', String(params.windowSize),
      '--turn-threshold', String(params.turnThreshold),
      '--smooth-days', String(params.smoothDays),
    ]);

    let stderr = '';
    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Python script failed with code ${code}: ${stderr}`));
      }
    });
  });
}
