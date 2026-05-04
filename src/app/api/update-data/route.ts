import { spawn } from 'child_process';
import { join } from 'path';
import { NextResponse } from 'next/server';
import { readPipelineJson } from '@/lib/serverData';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

interface UpdateResult {
  stdout: string;
  stderr: string;
}

interface UpdateSummary {
  eopRecordCount?: number;
  latestEopDate?: string;
  geomagRecordCount?: number;
  latestGeomagDate?: string;
  combinedRecordCount?: number;
  latestCombinedDate?: string;
}

let activeUpdate: Promise<UpdateResult> | null = null;
const UPDATE_TIMEOUT_MS = 15 * 60 * 1000;

function appendBounded(current: string, chunk: Buffer, maxLength = 20000) {
  const next = current + chunk.toString();
  return next.length > maxLength ? next.slice(next.length - maxLength) : next;
}

function runDataPipeline() {
  return new Promise<UpdateResult>((resolve, reject) => {
    const scriptPath = join(process.cwd(), 'scripts', 'run_pipeline.sh');
    const pipeline = spawn('bash', [scriptPath, '--compute-stats'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        COMPUTE_STATS: '1',
      },
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      pipeline.kill('SIGTERM');
      reject(new Error('Data update timed out after 15 minutes.'));
    }, UPDATE_TIMEOUT_MS);

    pipeline.stdout.on('data', (data: Buffer) => {
      stdout = appendBounded(stdout, data);
    });

    pipeline.stderr.on('data', (data: Buffer) => {
      stderr = appendBounded(stderr, data);
    });

    pipeline.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    pipeline.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`run_pipeline.sh exited with code ${code ?? 'unknown'}\n${stderr || stdout}`));
    });
  });
}

function summarizeSeries(records: any[] | undefined) {
  if (!Array.isArray(records) || records.length === 0) {
    return { recordCount: 0, latestDate: undefined };
  }

  const latest = records[records.length - 1];
  return {
    recordCount: records.length,
    latestDate: typeof latest?.t === 'string' ? latest.t.slice(0, 10) : undefined,
  };
}

async function collectUpdateSummary(): Promise<UpdateSummary> {
  const [eop, geomag, combined] = await Promise.all([
    readPipelineJson<any[]>('eop_historic.json').catch(() => undefined),
    readPipelineJson<any[]>('geomag_gfz_kp.json').catch(() => undefined),
    readPipelineJson<any[]>('combined_historic.json').catch(() => undefined),
  ]);
  const eopSummary = summarizeSeries(eop);
  const geomagSummary = summarizeSeries(geomag);
  const combinedSummary = summarizeSeries(combined);

  return {
    eopRecordCount: eopSummary.recordCount,
    latestEopDate: eopSummary.latestDate,
    geomagRecordCount: geomagSummary.recordCount,
    latestGeomagDate: geomagSummary.latestDate,
    combinedRecordCount: combinedSummary.recordCount,
    latestCombinedDate: combinedSummary.latestDate,
  };
}

export async function POST() {
  if (activeUpdate) {
    return NextResponse.json(
      { error: 'Data update is already running.' },
      { status: 409, headers: NO_STORE_HEADERS }
    );
  }

  activeUpdate = runDataPipeline();

  try {
    const result = await activeUpdate;
    const summary = await collectUpdateSummary();
    return NextResponse.json({
      ok: true,
      completedAt: new Date().toISOString(),
      summary,
      stdout: result.stdout,
      stderr: result.stderr,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('Data update failed:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Data update failed.',
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  } finally {
    activeUpdate = null;
  }
}
