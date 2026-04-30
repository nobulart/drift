import { NextRequest, NextResponse } from 'next/server';
import { spawn, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({
  windowSize: z.number().positive().default(365),
  turnThreshold: z.number().positive().default(0.05),
  centerWindow: z.number().positive().default(60),
  centerStep: z.number().positive().default(5),
  danceWindow: z.number().positive().default(120),
  conditionalTargetState: z.number().int().min(0).max(3).default(2),
  pathResolution: z.enum(['low', 'medium', 'high']).default('medium'),
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
      windowSize: searchParams.get('windowSize') ? parseFloat(searchParams.get('windowSize')!) : 365,
      turnThreshold: searchParams.get('turnThreshold') ? parseFloat(searchParams.get('turnThreshold')!) : 0.05,
      centerWindow: searchParams.get('centerWindow') ? parseFloat(searchParams.get('centerWindow')!) : 60,
      centerStep: searchParams.get('centerStep') ? parseFloat(searchParams.get('centerStep')!) : 5,
      danceWindow: searchParams.get('danceWindow') ? parseFloat(searchParams.get('danceWindow')!) : 120,
      conditionalTargetState: searchParams.get('conditionalTargetState') ? parseInt(searchParams.get('conditionalTargetState')!, 10) : 2,
      pathResolution: searchParams.get('pathResolution') || 'medium',
    });

    const dataPath = join(process.cwd(), 'public', 'data', 'eop_historic.json');
    
    // Create parameter-based cache key
    const cacheKey = crypto.createHash('md5')
      .update(JSON.stringify(params))
      .update(await fs.readFile(dataPath, 'utf8'))
      .digest('hex');
    
    const cacheDir = join(process.cwd(), 'public', 'data', '.rolling-stats-cache', params.pathResolution);
    const cachePath = join(cacheDir, `${cacheKey}.json`);

    // Ensure cache directory exists
    await fs.mkdir(cacheDir, { recursive: true });

    // Check cache
    let statsData: any = null;
    
    try {
      const stat = await fs.stat(cachePath);
      const ageMinutes = (Date.now() - stat.mtime.getTime()) / 1000 / 60;
      
      if (ageMinutes < 60) {
        const dataStr = await fs.readFile(cachePath, 'utf8');
        statsData = JSON.parse(dataStr);
      }
    } catch (err) {
      // Cache miss
    }

    // If not cached, run computation
    if (!statsData) {
      await runPythonComputation(
        dataPath,
        cachePath,
        params.windowSize,
        params.turnThreshold,
        params.centerWindow,
        params.centerStep,
        params.danceWindow,
        params.conditionalTargetState,
        params.pathResolution
      );

      const dataStr = await fs.readFile(cachePath, 'utf8');
      statsData = JSON.parse(dataStr);
    }

    return NextResponse.json(statsData);
  } catch (error) {
    console.error('Error computing rolling stats:', error);
    return NextResponse.json({ error: 'Failed to compute rolling stats' }, { status: 500 });
  }
}

async function runPythonComputation(
  inputPath: string,
  outputPath: string,
  windowSize: number,
  turnThreshold: number,
  centerWindow: number,
  centerStep: number,
  danceWindow: number,
  conditionalTargetState: number,
  pathResolution: string
) {
  return new Promise<void>((resolve, reject) => {
    const scriptPath = join(process.cwd(), 'scripts', 'compute_rolling_stats.py');
    
    let command: string;
    try {
      command = getPythonCommand();
    } catch (error) {
      reject(error);
      return;
    }

    const python = spawn(command, [
      scriptPath,
      '--input', inputPath,
      '--output', outputPath,
      '--window-size', windowSize.toString(),
      '--turn-threshold', turnThreshold.toString(),
      '--center-window', centerWindow.toString(),
      '--center-step', centerStep.toString(),
      '--dance-window', danceWindow.toString(),
      '--conditional-target-state', conditionalTargetState.toString(),
      '--path-resolution', pathResolution.toString()
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
