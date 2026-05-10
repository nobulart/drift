import { NextRequest, NextResponse } from 'next/server';
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/apiAuth';
import { getEOPDataset } from '@/lib/eopDatasets';
import { computePhaseStabilityDiagnostics } from '@/lib/phaseStabilityDiagnostics';
import { materializePipelineJson, readPipelineJson } from '@/lib/serverData';
import { TimeSample } from '@/lib/types';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

const DateParamSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const ParamsSchema = z.object({
  windowSize: z.number().positive().default(1825),
  turnThreshold: z.number().positive().default(0.05),
  centerWindow: z.number().positive().default(60),
  centerStep: z.number().positive().default(5),
  danceWindow: z.number().positive().default(120),
  conditionalTargetState: z.number().int().min(0).max(3).default(2),
  pathResolution: z.enum(['low', 'medium', 'high']).default('medium'),
  recentDays: z.number().int().positive().default(180),
  binCount: z.number().int().min(12).max(360).default(72),
  historicalStartDate: DateParamSchema,
  historicalEndDate: DateParamSchema,
});
const ViewSchema = z.enum(['full', 'panel']).default('full');

let pythonCommand: string | null = null;
const activeComputations = new Map<string, Promise<void>>();

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

function parseParams(searchParams: URLSearchParams): z.infer<typeof ParamsSchema> {
  return ParamsSchema.parse({
    windowSize: searchParams.get('windowSize') ? Number(searchParams.get('windowSize')) : 1825,
    turnThreshold: searchParams.get('turnThreshold') ? Number(searchParams.get('turnThreshold')) : 0.05,
    centerWindow: searchParams.get('centerWindow') ? Number(searchParams.get('centerWindow')) : 60,
    centerStep: searchParams.get('centerStep') ? Number(searchParams.get('centerStep')) : 5,
    danceWindow: searchParams.get('danceWindow') ? Number(searchParams.get('danceWindow')) : 120,
    conditionalTargetState: searchParams.get('conditionalTargetState') ? Number(searchParams.get('conditionalTargetState')) : 2,
    pathResolution: searchParams.get('pathResolution') || 'medium',
    recentDays: searchParams.get('recentDays') ? Number(searchParams.get('recentDays')) : 180,
    binCount: searchParams.get('binCount') ? Number(searchParams.get('binCount')) : 72,
    historicalStartDate: searchParams.get('historicalStartDate') || undefined,
    historicalEndDate: searchParams.get('historicalEndDate') || undefined,
  });
}

function projectPanelPayload(payload: any) {
  const samples = Array.isArray(payload?.samples) ? payload.samples : [];
  const latestDate = payload?.summary?.latestDate;
  const recentStart = latestDate
    ? new Date(`${latestDate}T00:00:00Z`).getTime() - (payload?.source?.recentDays ?? 180) * 24 * 60 * 60 * 1000
    : NaN;

  return {
    source: {
      ...payload.source,
      projectedView: 'panel',
    },
    summary: payload.summary ?? null,
    envelope: payload.envelope ?? [],
    samples: Number.isFinite(recentStart)
      ? samples.filter((sample: any) => {
          const time = new Date(`${sample?.date}T00:00:00Z`).getTime();
          return Number.isFinite(time) && time >= recentStart;
        })
      : samples.slice(-180),
  };
}

export async function GET(request: NextRequest) {
  const authResponse = requireApiAuth(request);
  if (authResponse) {
    return authResponse;
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const params = parseParams(searchParams);
    const view = ViewSchema.parse(searchParams.get('view') || 'full');
    const dataset = getEOPDataset(searchParams.get('dataset'));

    const eopPath = await materializePipelineJson(dataset.filename);
    const rollingScriptPath = join(process.cwd(), 'scripts', 'compute_rolling_stats.py');
    const diagnosticPath = join(process.cwd(), 'src', 'lib', 'phaseStabilityDiagnostics.ts');
    const [eopStat, rollingScriptStat, diagnosticStat] = await Promise.all([
      fs.stat(eopPath),
      fs.stat(rollingScriptPath),
      fs.stat(diagnosticPath),
    ]);

    const cacheKey = crypto.createHash('md5')
      .update(JSON.stringify(params))
      .update(dataset.id)
      .update(`${eopStat.mtimeMs}:${eopStat.size}`)
      .update(`${rollingScriptStat.mtimeMs}:${rollingScriptStat.size}`)
      .update(`${diagnosticStat.mtimeMs}:${diagnosticStat.size}`)
      .digest('hex');

    const cacheDir = join(process.cwd(), 'public', 'data', '.phase-stability-cache', dataset.id, params.pathResolution);
    const cachePath = join(cacheDir, `${cacheKey}.json`);
    const rollingPath = join(cacheDir, `${cacheKey}.rolling.json`);
    await fs.mkdir(cacheDir, { recursive: true });

    try {
      const cached = await fs.readFile(cachePath, 'utf8');
      const payload = JSON.parse(cached);
      return NextResponse.json(view === 'panel' ? projectPanelPayload(payload) : payload, { headers: NO_STORE_HEADERS });
    } catch {
      // Cache miss.
    }

    let activeComputation = activeComputations.get(cachePath);
    if (!activeComputation) {
      activeComputation = computeAndCachePhaseStability(eopPath, rollingPath, cachePath, dataset.id, params).finally(() => {
        activeComputations.delete(cachePath);
      });
      activeComputations.set(cachePath, activeComputation);
    }

    await activeComputation;
    const dataStr = await fs.readFile(cachePath, 'utf8');
    const payload = JSON.parse(dataStr);
    return NextResponse.json(view === 'panel' ? projectPanelPayload(payload) : payload, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('Error computing phase stability diagnostics:', error);
    return NextResponse.json({ error: 'Failed to compute phase stability diagnostics' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

async function computeAndCachePhaseStability(
  eopPath: string,
  rollingPath: string,
  cachePath: string,
  datasetId: string,
  params: z.infer<typeof ParamsSchema>
) {
  await runRollingStatsComputation(eopPath, rollingPath, params);
  const [rollingStats, eopRecords] = await Promise.all([
    fs.readFile(rollingPath, 'utf8').then((value) => JSON.parse(value)),
    readPipelineJson<TimeSample[]>(getEOPDataset(datasetId).filename),
  ]);

  const diagnostics = computePhaseStabilityDiagnostics(
    (rollingStats.theta || []).map((theta: number, index: number) => ({
      date: eopRecords[index]?.t?.slice(0, 10) ?? String(rollingStats.t?.[index] ?? index),
      theta,
      omega: rollingStats.omega?.[index] ?? NaN,
    })),
    {
      recentDays: params.recentDays,
      binCount: params.binCount,
      historicalStartDate: params.historicalStartDate,
      historicalEndDate: params.historicalEndDate,
    }
  );

  const payload = {
    source: {
      dataset: datasetId,
      windowSize: params.windowSize,
      turnThreshold: params.turnThreshold,
      centerWindow: params.centerWindow,
      centerStep: params.centerStep,
      danceWindow: params.danceWindow,
      conditionalTargetState: params.conditionalTargetState,
      pathResolution: params.pathResolution,
      recentDays: params.recentDays,
      binCount: params.binCount,
      historicalStartDate: params.historicalStartDate ?? null,
      historicalEndDate: params.historicalEndDate ?? null,
      generatedAt: new Date().toISOString(),
    },
    ...diagnostics,
  };

  await fs.writeFile(cachePath, JSON.stringify(payload));
}

async function runRollingStatsComputation(
  inputPath: string,
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

    const scriptPath = join(process.cwd(), 'scripts', 'compute_rolling_stats.py');
    const python = spawn(command, [
      scriptPath,
      '--input', inputPath,
      '--output', outputPath,
      '--window-size', String(params.windowSize),
      '--turn-threshold', String(params.turnThreshold),
      '--center-window', String(params.centerWindow),
      '--center-step', String(params.centerStep),
      '--dance-window', String(params.danceWindow),
      '--conditional-target-state', String(params.conditionalTargetState),
      '--path-resolution', params.pathResolution,
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
