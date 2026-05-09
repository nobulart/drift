import { NextRequest, NextResponse } from 'next/server';
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { materializePipelineJson } from '@/lib/serverData';
import { getEOPDataset } from '@/lib/eopDatasets';
import { requireApiAuth } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({
  windowSize: z.number().positive().default(1825),
  turnThreshold: z.number().positive().default(0.05),
  smoothDays: z.number().int().positive().default(31),
});
const ViewSchema = z.enum(['full', 'panel']).default('full');

let pythonCommand: string | null = null;
const activeComputations = new Map<string, Promise<void>>();

function projectPanelPayload(payload: any, composite: string | null) {
  if (!composite || !Array.isArray(payload?.records)) {
    return payload;
  }

  return {
    source: {
      ...payload.source,
      projectedView: 'panel',
      projectedComposite: composite,
    },
    records: payload.records.map((record: any) => ({
      t: record?.t,
      thetaRaw: record?.thetaRaw ?? null,
      thetaResidual: record?.thetaResidual ?? null,
      rRatio: record?.rRatio ?? null,
      misalignment: {
        [composite]: record?.misalignment?.[composite] ?? null,
      },
    })),
  };
}

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
  const authResponse = requireApiAuth(request);
  if (authResponse) {
    return authResponse;
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const params = ParamsSchema.parse({
      windowSize: searchParams.get('windowSize') ? Number(searchParams.get('windowSize')) : 1825,
      turnThreshold: searchParams.get('turnThreshold') ? Number(searchParams.get('turnThreshold')) : 0.05,
      smoothDays: searchParams.get('smoothDays') ? Number(searchParams.get('smoothDays')) : 31,
    });
    const view = ViewSchema.parse(searchParams.get('view') || 'full');
    const composite = searchParams.get('composite');

    const dataset = getEOPDataset(searchParams.get('dataset'));
    const eopPath = await materializePipelineJson(dataset.filename);
    const ephemerisPath = await materializePipelineJson('ephemeris_historic.json');

    const phaseScriptPath = join(process.cwd(), 'scripts', 'compute_phase_escape.py');
    const rollingScriptPath = join(process.cwd(), 'scripts', 'compute_rolling_stats.py');
    const [eopStat, ephemerisStat, phaseScriptStat, rollingScriptStat] = await Promise.all([
      fs.stat(eopPath),
      fs.stat(ephemerisPath),
      fs.stat(phaseScriptPath),
      fs.stat(rollingScriptPath),
    ]);

    const cacheKey = crypto.createHash('md5')
      .update(JSON.stringify(params))
      .update(dataset.id)
      .update(`${eopStat.mtimeMs}:${eopStat.size}`)
      .update(`${ephemerisStat.mtimeMs}:${ephemerisStat.size}`)
      .update(`${phaseScriptStat.mtimeMs}:${phaseScriptStat.size}`)
      .update(`${rollingScriptStat.mtimeMs}:${rollingScriptStat.size}`)
      .digest('hex');

    const cacheDir = join(process.cwd(), 'public', 'data', '.phase-escape-cache', dataset.id);
    const cachePath = join(cacheDir, `${cacheKey}.json`);
    await fs.mkdir(cacheDir, { recursive: true });

    try {
      const cached = await fs.readFile(cachePath, 'utf8');
      const payload = JSON.parse(cached);
      return NextResponse.json(view === 'panel' ? projectPanelPayload(payload, composite) : payload);
    } catch {
      // Cache miss.
    }

    let activeComputation = activeComputations.get(cachePath);
    if (!activeComputation) {
      activeComputation = runPythonComputation(eopPath, ephemerisPath, cachePath, params).finally(() => {
        activeComputations.delete(cachePath);
      });
      activeComputations.set(cachePath, activeComputation);
    }

    await activeComputation;
    const dataStr = await fs.readFile(cachePath, 'utf8');
    const payload = JSON.parse(dataStr);
    return NextResponse.json(view === 'panel' ? projectPanelPayload(payload, composite) : payload);
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
